const { loadConfig } = require("./config");
const { createStorage } = require("./storage");
const { ThrottleManager } = require("./throttle");
const { setupRabbitMQ } = require("./worker/queue");

async function createRuntime(options = {}) {
  const config = loadConfig({ configPath: options.configPath });
  const storage = await createStorage(config);
  const throttle = new ThrottleManager(config.throttle || {});

  let rabbit = null;
  if (config.worker?.enable) {
    rabbit = await setupRabbitMQ(config);
  }

  return {
    config,
    storage,
    throttle,
    rabbit,
    async close() {
      try {
        if (rabbit?.channel) await rabbit.channel.close();
      } catch (_) {}
      try {
        if (rabbit?.conn) await rabbit.conn.close();
      } catch (_) {}
      try {
        await storage.close();
      } catch (_) {}
    },
  };
}

module.exports = {
  createRuntime,
};
