// @ts-nocheck
const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { stringify } = require("csv-stringify/sync");

let appVersion = "0.0.0";
try {
  appVersion = require(path.resolve(process.cwd(), "package.json")).version || appVersion;
} catch (_) {}
const { checkEmail } = require("../checker/checkEmail");
const { mapRequestToCheckInput } = require("./requestMapper");
const { badRequest, internalError } = require("./errors");
const { publishTask, MAX_QUEUE_PRIORITY } = require("../worker/queue");

function resolvePublicDir() {
  const candidates = [
    path.resolve(__dirname, "..", "..", "public"),
    path.resolve(__dirname, "..", "..", "..", "public"),
    path.resolve(process.cwd(), "public"),
  ];

  for (const dir of candidates) {
    try {
      const stat = require("node:fs").statSync(dir);
      if (stat.isDirectory()) {
        return dir;
      }
    } catch (_) {}
  }

  return null;
}

function getAllowedOrigins(config) {
  const raw = config?.cors?.origins ?? config?.cors_origins ?? ["*"];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  return String(raw)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function applyCors(req, res, allowedOrigins) {
  const requestOrigin = req.headers.origin;
  const allowsAll = allowedOrigins.includes("*");

  if (allowsAll) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-api-secret,authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function isSameOriginBrowserRequest(req) {
  const host = String(req.headers.host || "").toLowerCase();
  if (!host) return false;

  const origin = String(req.headers.origin || "").trim();
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (originHost === host) {
        return true;
      }
    } catch (_) {}
  }

  const referer = String(req.headers.referer || "").trim();
  if (referer) {
    try {
      const refererHost = new URL(referer).host.toLowerCase();
      if (refererHost === host) {
        return true;
      }
    } catch (_) {}
  }

  return false;
}

function checkHeaderSecret(req, config) {
  if (!config.header_secret) {
    return { ok: true };
  }

  if (config.allow_browser_without_secret && isSameOriginBrowserRequest(req)) {
    return { ok: true };
  }

  const expected = String(config.header_secret);
  if (expected.length === 0) {
    return { ok: true };
  }

  const actual = req.header("x-api-secret");
  if (!actual) {
    return {
      ok: false,
      code: 400,
      body: { error: 'Missing request header "x-api-secret"' },
    };
  }

  if (actual !== expected) {
    return {
      ok: false,
      code: 400,
      body: { error: 'Invalid request header "x-api-secret"' },
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
          "Please enable worker mode before calling this endpoint",
      },
    };
  }

  if (runtime.config.storage.type !== "postgres") {
    return {
      ok: false,
      code: 503,
      body: {
        error:
          "Please configure a Postgres database before calling this endpoint",
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
  const r = result && typeof result === "object" ? result : {};

  return {
    input: r.input ?? "",
    is_reachable: r.is_reachable ?? "",
    email_address: r.email_address ?? "",
    email_username: r.email_username ?? "",
    email_domain: r.email_domain ?? "",
    is_valid_syntax: Boolean(r.is_valid_syntax),
    is_disposable_email: Boolean(r.is_disposable_email),
    is_role_account: Boolean(r.is_role_account),
    is_b2c_provider: Boolean(r.is_b2c_provider),
    gravatar_url: r.gravatar_url ?? null,
    mx_accepts_mail: Boolean(r.mx_accepts_mail),
    mx_preferred_host: r.mx_preferred_host ?? null,
    smtp_can_connect: Boolean(r.smtp_can_connect),
    smtp_has_full_inbox: Boolean(r.smtp_has_full_inbox),
    smtp_is_catch_all: Boolean(r.smtp_is_catch_all),
    smtp_is_deliverable: Boolean(r.smtp_is_deliverable),
    smtp_is_disabled_account: Boolean(r.smtp_is_disabled_account),
    error:
      r.smtp_error_message ?? r.mx_lookup_error_message ?? r.error ?? null,
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
  const allowedOrigins = getAllowedOrigins(runtime.config);

  app.use((req, res, next) => {
    applyCors(req, res, allowedOrigins);
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));

  const publicDir = resolvePublicDir();
  if (publicDir) {
    app.use(express.static(publicDir));
  }

  app.get("/", (_req, res) => {
    res.status(200).json({
      ok: true,
      name: "email-validation-service",
      version: appVersion,
      endpoints: ["/health", "/version", "/v1/check_email"],
    });
  });

  app.get("/version", (_req, res) => {
    res.json({
      version: appVersion,
      smtp_port: Number(process.env.EMAIL_CHECKER_SMTP_PORT || 25),
    });
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
  mapResultToCsvRow,
};
