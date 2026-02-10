const { loadConfig } = require("../config");
const { createStorage } = require("../storage");
const { ThrottleManager } = require("../throttle");
const { CHECK_EMAIL_QUEUE, setupRabbitMQ } = require("./queue");
const { processCheckEmailTask, taskError } = require("./service");
const { sendSingleShotReply } = require("./singleShot");

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

      const workerOutput = await processCheckEmailTask(task, config);

      if (
        workerOutput.ok &&
        workerOutput.result?.is_reachable === "unknown" &&
        !msg.fields.redelivered
      ) {
        channel.nack(msg, false, true);
        return;
      }

      if (!workerOutput.ok && !msg.fields.redelivered) {
        channel.nack(msg, false, true);
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
      // eslint-disable-next-line no-console
      console.log("worker started");
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err?.stack || err?.message || String(err));
      process.exit(1);
    });
}

module.exports = {
  startWorker,
};
