// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/http/app");
const { NoopStorage } = require("../src/storage");
const { ThrottleManager } = require("../src/throttle");

function buildRuntime() {
  return {
    config: {
      worker: { enable: false },
      throttle: {},
      cors: { origins: ["*"] },
      header_secret: null,
    },
    storage: new NoopStorage(),
    throttle: new ThrottleManager({}),
    rabbit: null,
  };
}

async function startApp() {
  const app = createApp(buildRuntime());
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

test("GET /metrics returns Prometheus exposition with all custom metrics declared", async () => {
  const { baseUrl, close } = await startApp();
  try {
    const res = await fetch(`${baseUrl}/metrics`);
    assert.equal(res.status, 200);

    const ct = res.headers.get("content-type") || "";
    assert.match(ct, /text\/plain/);
    assert.match(ct, /version=0\.0\.4/);

    const body = await res.text();

    assert.match(body, /# HELP check_email_total /);
    assert.match(body, /# TYPE check_email_total counter/);

    assert.match(body, /# HELP check_email_duration_seconds /);
    assert.match(body, /# TYPE check_email_duration_seconds histogram/);

    assert.match(body, /# HELP bulk_job_active /);
    assert.match(body, /# TYPE bulk_job_active gauge/);

    assert.match(body, /# HELP smtp_errors_total /);
    assert.match(body, /# TYPE smtp_errors_total counter/);

    assert.match(body, /process_cpu_seconds_total/);
  } finally {
    await close();
  }
});

test("POST /v1/check_email increments check_email_total{verdict=invalid} for bad syntax", async () => {
  const { baseUrl, close } = await startApp();
  try {
    function parseInvalidVerdict(body) {
      const match = body.match(
        /^check_email_total\{verdict="invalid"\}\s+(\d+(?:\.\d+)?)/m
      );
      return match ? Number(match[1]) : 0;
    }

    const before = parseInvalidVerdict(await (await fetch(`${baseUrl}/metrics`)).text());

    const res = await fetch(`${baseUrl}/v1/check_email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to_email: "not-an-email" }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.is_reachable, "invalid");

    const after = parseInvalidVerdict(await (await fetch(`${baseUrl}/metrics`)).text());
    assert.equal(after, before + 1);

    const body = await (await fetch(`${baseUrl}/metrics`)).text();
    assert.match(body, /check_email_duration_seconds_count\s+\d+/);
  } finally {
    await close();
  }
});
