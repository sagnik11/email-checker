const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { stringify } = require("csv-stringify/sync");

const pkg = require("../../package.json");
const { checkEmail } = require("../checker/checkEmail");
const { mapRequestToCheckInput } = require("./requestMapper");
const { badRequest, internalError } = require("./errors");
const { publishTask, MAX_QUEUE_PRIORITY } = require("../worker/queue");

function checkHeaderSecret(req, config) {
  if (!config.header_secret) {
    return { ok: true };
  }

  const expected = String(config.header_secret);
  if (expected.length === 0) {
    return { ok: true };
  }

  const actual = req.header("x-wq-secret");
  if (!actual) {
    return {
      ok: false,
      code: 400,
      body: { error: 'Missing request header "x-wq-secret"' },
    };
  }

  if (actual !== expected) {
    return {
      ok: false,
      code: 400,
      body: { error: 'Invalid request header "x-wq-secret"' },
    };
  }

  return { ok: true };
}

function requireWorkerDb(runtime) {
  if (!runtime.config.worker.enable) {
    return {
      ok: false,
      code: 503,
      body: {
        error:
          "Please enable worker mode on WorqHat Email Checker before calling this endpoint",
      },
    };
  }

  if (runtime.config.storage.type !== "postgres") {
    return {
      ok: false,
      code: 503,
      body: {
        error:
          "Please configure a Postgres database on WorqHat Email Checker before calling this endpoint",
      },
    };
  }

  if (!runtime.rabbit?.conn || !runtime.rabbit?.channel) {
    return {
      ok: false,
      code: 503,
      body: { error: "Worker RabbitMQ channel is not available" },
    };
  }

  return { ok: true };
}

function mapResultToCsvRow(result) {
  const misc = result?.misc && typeof result.misc === "object" ? result.misc : {};
  const mx = result?.mx && typeof result.mx === "object" ? result.mx : {};
  const smtp = result?.smtp && typeof result.smtp === "object" ? result.smtp : {};
  const syntax = result?.syntax && typeof result.syntax === "object" ? result.syntax : {};

  return {
    input: result?.input ?? "",
    is_reachable: result?.is_reachable ?? "",
    "misc.is_disposable": Boolean(misc.is_disposable),
    "misc.is_role_account": Boolean(misc.is_role_account),
    "misc.gravatar_url": misc.gravatar_url ?? null,
    "mx.accepts_mail": Boolean(mx.accepts_mail),
    "smtp.can_connect": Boolean(smtp.can_connect_smtp),
    "smtp.has_full_inbox": Boolean(smtp.has_full_inbox),
    "smtp.is_catch_all": Boolean(smtp.is_catch_all),
    "smtp.is_deliverable": Boolean(smtp.is_deliverable),
    "smtp.is_disabled": Boolean(smtp.is_disabled),
    "syntax.is_valid_syntax": Boolean(syntax.is_valid_syntax),
    "syntax.domain": syntax.domain ?? "",
    "syntax.username": syntax.username ?? "",
    error:
      result?.error ||
      result?.smtp?.error?.message ||
      result?.mx?.error?.message ||
      result?.misc?.error?.message ||
      null,
  };
}

function parseLimitOffset(req) {
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : null;
  const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
  return {
    limit: Number.isFinite(limit) ? limit : null,
    offset: Number.isFinite(offset) ? offset : 0,
  };
}

async function rpcCheckEmail(runtime, task) {
  const ch = await runtime.rabbit.conn.createChannel();
  try {
    const replyQueue = await ch.assertQueue("", {
      exclusive: true,
      durable: false,
      autoDelete: true,
    });

    const correlationId = crypto.randomUUID();
    const timeoutMs = 120000;

    const resultPromise = new Promise((resolve, reject) => {
      let timer;
      ch.consume(
        replyQueue.queue,
        (msg) => {
          if (!msg) return;

          if (msg.properties.correlationId !== correlationId) {
            ch.ack(msg);
            return;
          }

          clearTimeout(timer);
          ch.ack(msg);

          try {
            const payload = JSON.parse(msg.content.toString("utf8"));
            resolve(payload);
          } catch (err) {
            reject(err);
          }
        },
        { noAck: false }
      )
        .then((consumeOk) => {
          timer = setTimeout(async () => {
            try {
              await ch.cancel(consumeOk.consumerTag);
            } catch (_) {}
            reject(new Error("Failed to get a reply from the worker."));
          }, timeoutMs);
        })
        .catch(reject);
    });

    await publishTask(runtime.rabbit.channel, task, {
      priority: MAX_QUEUE_PRIORITY,
      correlationId,
      replyTo: replyQueue.queue,
    });

    const response = await resultPromise;
    if (response.kind === "ok") {
      return JSON.parse(Buffer.from(response.body, "base64").toString("utf8"));
    }

    const err = new Error(response.error || "Worker error");
    err.statusCode = Number(response.code || 500);
    throw err;
  } finally {
    try {
      await ch.close();
    } catch (_) {}
  }
}

function createApp(runtime) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  const publicDir = path.resolve(__dirname, "..", "..", "public");
  app.use(express.static(publicDir));

  app.get("/version", (_req, res) => {
    res.json({ version: pkg.version });
  });

  app.post("/v1/check_email", async (req, res) => {
    const auth = checkHeaderSecret(req, runtime.config);
    if (!auth.ok) return res.status(auth.code).json(auth.body);

    if (!req.body?.to_email) {
      return badRequest(res, "to_email field is required.");
    }

    const throttleResult = runtime.throttle.checkThrottle();
    if (throttleResult) {
      return res.status(429).json({
        error: `Rate limit ${throttleResult.limit_type} exceeded, please wait ${throttleResult.delay_ms}ms`,
      });
    }

    try {
      const input = mapRequestToCheckInput(req.body, runtime.config, { job_source: "v1" });

      if (!runtime.config.worker.enable) {
        const result = await checkEmail(input);
        runtime.throttle.incrementCounters();

        await runtime.storage.store(
          {
            input,
            job_id: { kind: "single_shot" },
            webhook: null,
          },
          { ok: true, result },
          runtime.storage.getExtra()
        );

        return res.json(result);
      }

      const workerCheck = requireWorkerDb(runtime);
      if (!workerCheck.ok) {
        return res.status(workerCheck.code).json(workerCheck.body);
      }

      const result = await rpcCheckEmail(runtime, {
        input,
        job_id: { kind: "single_shot" },
        webhook: null,
      });

      return res.json(result);
    } catch (err) {
      return res.status(Number(err.statusCode || 500)).json({ error: err.message });
    }
  });

  app.post("/v1/bulk", async (req, res) => {
    const auth = checkHeaderSecret(req, runtime.config);
    if (!auth.ok) return res.status(auth.code).json(auth.body);

    if (!Array.isArray(req.body?.input) || req.body.input.length === 0) {
      return badRequest(res, "Empty input");
    }

    const workerDb = requireWorkerDb(runtime);
    if (!workerDb.ok) {
      return res.status(workerDb.code).json(workerDb.body);
    }

    try {
      const jobId = await runtime.storage.createV1BulkJob(req.body.input.length);
      for (const toEmail of req.body.input) {
        const input = mapRequestToCheckInput(
          { to_email: toEmail },
          runtime.config,
          { job_source: "v1_bulk" }
        );

        await publishTask(runtime.rabbit.channel, {
          input,
          job_id: { kind: "bulk_v1", id: jobId },
          webhook: req.body.webhook || null,
        }, {
          priority: 1,
        });
      }

      return res.json({ job_id: jobId });
    } catch (err) {
      return internalError(res, err);
    }
  });

  app.get("/v1/bulk/:id", async (req, res) => {
    const workerDb = requireWorkerDb(runtime);
    if (!workerDb.ok) {
      return res.status(workerDb.code).json(workerDb.body);
    }

    try {
      const progress = await runtime.storage.getV1BulkProgress(Number(req.params.id));
      if (!progress) {
        return badRequest(res, "Job not found");
      }
      return res.json(progress);
    } catch (err) {
      return internalError(res, err);
    }
  });

  app.get("/v1/bulk/:id/results", async (req, res) => {
    const workerDb = requireWorkerDb(runtime);
    if (!workerDb.ok) {
      return res.status(workerDb.code).json(workerDb.body);
    }

    try {
      const jobId = Number(req.params.id);
      const job = await runtime.storage.getV1BulkJob(jobId);
      if (!job) {
        return badRequest(res, "Job not found");
      }

      const processed = await runtime.storage.countV1Processed(jobId);
      if (processed < Number(job.total_records)) {
        return badRequest(res, `Job ${jobId} is still running, please try again later`);
      }

      const { limit, offset } = parseLimitOffset(req);
      const format = String(req.query.format || "json").toLowerCase();
      const rows = await runtime.storage.getV1Results(
        jobId,
        limit === null ? (format === "json" ? 50 : null) : limit,
        offset
      );

      if (format === "csv") {
        const csv = stringify(rows.map(mapResultToCsvRow), { header: true });
        res.setHeader("content-type", "text/csv");
        return res.send(csv);
      }

      return res.json({ results: rows });
    } catch (err) {
      return internalError(res, err);
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

module.exports = {
  createApp,
};
