// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

test("env overrides map WQ__ paths", () => {
  const cfg = loadConfig({
    fromObject: {},
    env: {
      WQ__HTTP_PORT: "9090",
      WQ__WORKER__ENABLE: "true",
      WQ__WORKER__RABBITMQ__CONCURRENCY: "7",
      WQ__STORAGE__POSTGRES__DB_URL: "postgres://localhost/test",
    },
  });

  assert.equal(cfg.http_port, 9090);
  assert.equal(cfg.worker.enable, true);
  assert.equal(cfg.worker.rabbitmq.concurrency, 7);
  assert.equal(cfg.storage.type, "postgres");
});
