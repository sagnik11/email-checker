// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/http/app");
const { defaultConfig } = require("../src/config");

function createBaseRuntime() {
  return {
    config: {
      ...defaultConfig(),
      storage: { type: "postgres" },
      worker: {
        enable: true,
        rabbitmq: {
          url: "amqp://localhost:5672",
          concurrency: 1,
        },
      },
    },
    storage: {
      pool: {
        query: async () => ({ rows: [{ "?column?": 1 }] }),
      },
    },
    rabbit: {
      channel: {
        checkQueue: async () => ({ queue: "check_email" }),
      },
    },
    throttle: {
      checkThrottle: () => null,
      incrementCounters: () => {},
    },
  };
}

async function request(app, path) {
  const server = app.listen(0);
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return {
      status: res.status,
      body: await res.json(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("/health returns 200 while process is alive", async () => {
  const runtime = createBaseRuntime();
  runtime.storage.pool.query = async () => {
    throw new Error("postgres down");
  };
  runtime.rabbit.channel.checkQueue = async () => {
    throw new Error("rabbit down");
  };

  const app = createApp(runtime);
  const res = await request(app, "/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("/ready returns 200 when Postgres and RabbitMQ are reachable", async () => {
  const app = createApp(createBaseRuntime());
  const res = await request(app, "/ready");

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dependencies.postgres.ok, true);
  assert.equal(res.body.dependencies.rabbitmq.ok, true);
  assert.equal(res.body.dependencies.rabbitmq.queue, "check_email");
});

test("/ready returns 503 when Postgres probe fails", async () => {
  const runtime = createBaseRuntime();
  runtime.storage.pool.query = async () => {
    throw new Error("connect ECONNREFUSED postgres");
  };

  const app = createApp(runtime);
  const res = await request(app, "/ready");

  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.dependencies.postgres.ok, false);
  assert.match(res.body.dependencies.postgres.error, /ECONNREFUSED/);
  assert.equal(res.body.dependencies.rabbitmq.ok, true);
});

test("/ready returns 503 when RabbitMQ probe fails", async () => {
  const runtime = createBaseRuntime();
  runtime.rabbit.channel.checkQueue = async () => {
    throw new Error("channel closed");
  };

  const app = createApp(runtime);
  const res = await request(app, "/ready");

  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.dependencies.postgres.ok, true);
  assert.equal(res.body.dependencies.rabbitmq.ok, false);
  assert.match(res.body.dependencies.rabbitmq.error, /channel closed/i);
});
