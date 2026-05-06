// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

test("env overrides map EMAIL_CHECKER__ paths", () => {
  const cfg = loadConfig({
    fromObject: {},
    env: {
      EMAIL_CHECKER__HTTP_PORT: "9090",
      EMAIL_CHECKER__WORKER__ENABLE: "true",
      EMAIL_CHECKER__WORKER__RABBITMQ__CONCURRENCY: "7",
      EMAIL_CHECKER__STORAGE__POSTGRES__DB_URL: "postgres://localhost/test",
    },
  });

  assert.equal(cfg.http_port, 9090);
  assert.equal(cfg.worker.enable, true);
  assert.equal(cfg.worker.rabbitmq.concurrency, 7);
  assert.equal(cfg.storage.type, "postgres");
});
