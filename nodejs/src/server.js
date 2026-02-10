const { createRuntime } = require("./runtime");
const { createApp } = require("./http/app");
const { startWorker } = require("./worker/run");

async function startServer(options = {}) {
  const runtime = options.runtime || (await createRuntime({ configPath: options.configPath }));
  const app = createApp(runtime);

  const host = options.host || runtime.config.http_host || "127.0.0.1";
  const port = Number(options.port || runtime.config.http_port || 8080);
  runtime.config.http_host = host;
  runtime.config.http_port = port;

  const server = await new Promise((resolve) => {
    const s = app.listen(port, host, () => resolve(s));
  });

  let workerHandle = null;
  const shouldRunWorker =
    options.runWorkerInline !== undefined
      ? options.runWorkerInline
      : Boolean(runtime.config.worker?.enable);

  if (shouldRunWorker && runtime.config.worker?.enable) {
    workerHandle = await startWorker({
      config: runtime.config,
      storage: runtime.storage,
      throttle: runtime.throttle,
      rabbit: runtime.rabbit,
    });
  }

  return {
    app,
    server,
    runtime,
    workerHandle,
    async close() {
      if (workerHandle?.close) {
        await workerHandle.close();
      }

      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await runtime.close();
    },
  };
}

if (require.main === module) {
  startServer()
    .then(({ runtime }) => {
      // eslint-disable-next-line no-console
      console.log(
        `wq-email-checker-node listening on http://${runtime.config.http_host}:${runtime.config.http_port}`
      );
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err?.stack || err?.message || String(err));
      process.exit(1);
    });
}

module.exports = {
  startServer,
};
