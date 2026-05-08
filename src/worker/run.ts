// @ts-nocheck
const { loadConfig } = require("../config");
const { createStorage } = require("../storage");
const { ThrottleManager } = require("../throttle");
const {
  CHECK_EMAIL_QUEUE,
  DLQ_QUEUE,
  DLX_EXCHANGE,
  DLQ_ROUTING_KEY,
  setupRabbitMQ,
} = require("./queue");
const { processCheckEmailTask, taskError } = require("./service");
const { sendSingleShotReply } = require("./singleShot");
const { logger } = require("../logger");
const {
  bulkJobActive,
  checkEmailDuration,
  recordVerdict,
} = require("../http/metrics");

function isBulkTask(task) {
  return task?.job_id?.kind === "bulk_v1" || task?.job_id?.kind === "bulk_v0";
}

function publishToDlq(channel, msg, lastError) {
  channel.publish(DLX_EXCHANGE, DLQ_ROUTING_KEY, msg.content, {
    contentType: msg.properties?.contentType || "application/json",
    persistent: true,
    headers: {
      ...(msg.properties?.headers || {}),
      "x-last-error": String(lastError ?? "retry_exhausted"),
      "x-attempts": 2,
    },
  });
}

async function startWorker(deps) {
  const config = deps?.config || loadConfig();
  if (!config.worker?.enable) {
    throw new Error("Worker mode is disabled. Set worker.enable = true in config.");
  }

  const ownsStorage = !deps?.storage;
  const ownsRabbit = !deps?.rabbit;
  const storage = deps?.storage || (await createStorage(config));
  const throttle = deps?.throttle || new ThrottleManager(config.throttle || {});
  const rabbit = deps?.rabbit || (await setupRabbitMQ(config));
  const { channel } = rabbit;

  await channel.consume(
    CHECK_EMAIL_QUEUE,
    async (msg) => {
      if (!msg) return;

      let task;
      try {
        task = JSON.parse(msg.content.toString("utf8"));
      } catch (_) {
        channel.ack(msg);
        return;
      }

      const throttleResult = throttle.checkThrottle();
      if (throttleResult) {
        if (task.job_id?.kind === "single_shot") {
          channel.ack(msg);
          await sendSingleShotReply(channel, msg, {
            ok: false,
            error: taskError(
              `Rate limit ${throttleResult.limit_type} exceeded, please wait ${throttleResult.delay_ms}ms`,
              429
            ),
          });
        } else {
          channel.nack(msg, false, true);
        }
        return;
      }

      throttle.incrementCounters();

      bulkJobActive.inc();
      const stopTimer = checkEmailDuration.startTimer();
      let workerOutput;
      try {
        workerOutput = await processCheckEmailTask(task, config);
      } finally {
        stopTimer();
        bulkJobActive.dec();
      }

      if (workerOutput?.ok) {
        recordVerdict(workerOutput.result?.is_reachable);
      } else {
        recordVerdict("unknown");
      }

      const isUnknown =
        workerOutput.ok && workerOutput.result?.is_reachable === "unknown";
      const isFailure = !workerOutput.ok;
      const failedThisAttempt = isUnknown || isFailure;

      if (failedThisAttempt && !msg.fields.redelivered) {
        channel.nack(msg, false, true);
        return;
      }

      if (failedThisAttempt && msg.fields.redelivered && isBulkTask(task)) {
        const lastError = isFailure
          ? workerOutput.error?.message || "task_failed"
          : "is_reachable=unknown after retry";
        try {
          publishToDlq(channel, msg, lastError);
        } catch (_) {
          // ignore publish failures
        }
        channel.ack(msg);
        return;
      }

      channel.ack(msg);

      if (task.job_id?.kind === "single_shot") {
        await sendSingleShotReply(channel, msg, workerOutput);
      }

      try {
        await storage.store(task, workerOutput, storage.getExtra());
      } catch (_) {
        // ignore storage failures in worker loop
      }
    },
    { noAck: false }
  );

  await channel.consume(
    DLQ_QUEUE,
    async (msg) => {
      if (!msg) return;

      let task;
      try {
        task = JSON.parse(msg.content.toString("utf8"));
      } catch (_) {
        channel.ack(msg);
        return;
      }

      const headers = msg.properties?.headers || {};
      const lastError = String(headers["x-last-error"] || "retry_exhausted");
      const attempts = Number(headers["x-attempts"] || 2);

      try {
        if (typeof storage.storeDlqFailure === "function") {
          await storage.storeDlqFailure(task, {
            error: lastError,
            attempts,
          });
        }
      } catch (_) {
        // ignore storage failures in DLQ loop
      }

      channel.ack(msg);
    },
    { noAck: false }
  );

  return {
    config,
    storage,
    rabbit,
    close: async () => {
      if (ownsRabbit) {
        try {
          await rabbit.channel.close();
        } catch (_) {}
        try {
          await rabbit.conn.close();
        } catch (_) {}
      }
      if (ownsStorage) {
        try {
          await storage.close();
        } catch (_) {}
      }
    },
  };
}

if (require.main === module) {
  startWorker()
    .then(() => {
      logger.info({ source: "worker" }, "worker started");
    })
    .catch((err) => {
      logger.error(
        { source: "worker", err: err?.stack || err?.message || String(err) },
        "worker failed to start"
      );
      process.exit(1);
    });
}

module.exports = {
  startWorker,
};
