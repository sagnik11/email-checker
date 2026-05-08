// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { deliverWebhook, signPayload } = require("../src/worker/service");

function makeTask(url, opts = {}) {
  return {
    input: { to_email: opts.email || "alice@example.com" },
    job_id: opts.jobId || { kind: "bulk_v1", id: 42 },
    webhook: {
      on_each_email: {
        url,
        headers: opts.headers,
        extra: opts.extra ?? null,
      },
    },
  };
}

function makeFetchSequence(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    if (typeof next === "function") return next();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

function captureLogger() {
  const lines = [];
  return {
    log: (line) => lines.push(line),
    lines,
  };
}

const noopSleep = async () => {};

test("signPayload: HMAC-SHA256 hex of body", () => {
  const sig = signPayload("topsecret", '{"a":1}');
  const expected = crypto
    .createHmac("sha256", "topsecret")
    .update('{"a":1}')
    .digest("hex");
  assert.equal(sig, expected);
});

test("signPayload: empty when secret missing", () => {
  assert.equal(signPayload(null, "x"), "");
  assert.equal(signPayload("", "x"), "");
});

test("deliverWebhook: succeeds on first 200, no retries", async () => {
  const fetchImpl = makeFetchSequence([{ status: 200 }]);
  const logger = captureLogger();

  await deliverWebhook(
    makeTask("http://test.local/hook"),
    { is_reachable: "safe" },
    { worker: { webhook: { secret: "s3cret" } } },
    { fetch: fetchImpl, sleep: noopSleep, logger }
  );

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(logger.lines.length, 0);
});

test("deliverWebhook: retries on 500 then succeeds", async () => {
  const fetchImpl = makeFetchSequence([
    { status: 500 },
    { status: 502 },
    { status: 200 },
  ]);
  const logger = captureLogger();

  await deliverWebhook(
    makeTask("http://test.local/hook"),
    { is_reachable: "safe" },
    { worker: { webhook: { secret: "s" } } },
    { fetch: fetchImpl, sleep: noopSleep, logger }
  );

  assert.equal(fetchImpl.calls.length, 3);
  assert.equal(logger.lines.length, 0);
});

test("deliverWebhook: 4x failure logs structured error", async () => {
  const fetchImpl = makeFetchSequence([
    { status: 500 },
    { status: 500 },
    { status: 502 },
    { status: 503 },
  ]);
  const logger = captureLogger();

  await deliverWebhook(
    makeTask("http://test.local/hook"),
    { is_reachable: "safe" },
    { worker: { webhook: { secret: "s" } } },
    { fetch: fetchImpl, sleep: noopSleep, logger }
  );

  assert.equal(fetchImpl.calls.length, 4);
  assert.equal(logger.lines.length, 1);
  const parsed = JSON.parse(logger.lines[0]);
  assert.equal(parsed.event, "webhook_delivery_failed");
  assert.equal(parsed.endpoint, "http://test.local/hook");
  assert.equal(parsed.attempts, 4);
  assert.equal(parsed.status, 503);
  assert.ok(parsed.taskId);
  assert.deepEqual(parsed.jobId, { kind: "bulk_v1", id: 42 });
});

test("deliverWebhook: 4xx is non-retriable", async () => {
  const fetchImpl = makeFetchSequence([{ status: 400 }]);
  const logger = captureLogger();

  await deliverWebhook(
    makeTask("http://test.local/hook"),
    { is_reachable: "safe" },
    { worker: { webhook: { secret: "s" } } },
    { fetch: fetchImpl, sleep: noopSleep, logger }
  );

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(logger.lines.length, 1);
  const parsed = JSON.parse(logger.lines[0]);
  assert.equal(parsed.status, 400);
});

test("deliverWebhook: network errors retry then log", async () => {
  const fetchImpl = makeFetchSequence([
    new Error("ECONNREFUSED"),
    new Error("ECONNREFUSED"),
    new Error("ECONNREFUSED"),
    new Error("ECONNREFUSED"),
  ]);
  const logger = captureLogger();

  await deliverWebhook(
    makeTask("http://test.local/hook"),
    { is_reachable: "safe" },
    { worker: { webhook: { secret: "s" } } },
    { fetch: fetchImpl, sleep: noopSleep, logger }
  );

  assert.equal(fetchImpl.calls.length, 4);
  assert.equal(logger.lines.length, 1);
  const parsed = JSON.parse(logger.lines[0]);
  assert.match(parsed.error, /ECONNREFUSED/);
});

test("deliverWebhook: backoff schedule is 1s,5s,30s before attempts 2, 3, 4", async () => {
  const fetchImpl = makeFetchSequence([
    { status: 500 },
    { status: 500 },
    { status: 500 },
    { status: 200 },
  ]);
  const sleeps = [];
  const fakeSleep = async (ms) => {
    sleeps.push(ms);
  };

  await deliverWebhook(
    makeTask("http://test.local/hook"),
    { is_reachable: "safe" },
    { worker: { webhook: { secret: "s" } } },
    { fetch: fetchImpl, sleep: fakeSleep, logger: captureLogger() }
  );

  assert.deepEqual(sleeps, [1000, 5000, 30000]);
});

test("deliverWebhook: skipped when no url", async () => {
  const fetchImpl = makeFetchSequence([]);
  const task = { input: { to_email: "x@y.z" }, job_id: null, webhook: null };

  await deliverWebhook(task, { ok: true }, { worker: { webhook: { secret: "s" } } }, {
    fetch: fetchImpl,
    sleep: noopSleep,
    logger: captureLogger(),
  });

  assert.equal(fetchImpl.calls.length, 0);
});

test("deliverWebhook: omits signature header when no secret", async () => {
  const fetchImpl = makeFetchSequence([{ status: 200 }]);

  await deliverWebhook(
    makeTask("http://test.local/hook"),
    { ok: true },
    { worker: { webhook: { secret: null } } },
    { fetch: fetchImpl, sleep: noopSleep, logger: captureLogger() }
  );

  const headers = fetchImpl.calls[0].init.headers;
  assert.equal(headers["x-webhook-signature"], undefined);
  assert.equal(headers["content-type"], "application/json");
});

test("deliverWebhook: signature header cannot be overridden by user headers", async () => {
  const fetchImpl = makeFetchSequence([{ status: 200 }]);

  await deliverWebhook(
    makeTask("http://test.local/hook", {
      headers: { "x-webhook-signature": "attacker" },
    }),
    { ok: true },
    { worker: { webhook: { secret: "real-secret" } } },
    { fetch: fetchImpl, sleep: noopSleep, logger: captureLogger() }
  );

  const headers = fetchImpl.calls[0].init.headers;
  assert.notEqual(headers["x-webhook-signature"], "attacker");
  assert.match(headers["x-webhook-signature"], /^[a-f0-9]{64}$/);
});

test("integration: mock server receives signed payload with all keys", async () => {
  const received = { headers: null, body: null };
  const server = http.createServer((req, res) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      received.headers = req.headers;
      received.body = buf;
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/hook`;

  try {
    const secret = "integration-secret";
    const result = { is_reachable: "safe", input: "alice@example.com" };

    await deliverWebhook(
      makeTask(url, {
        email: "alice@example.com",
        jobId: { kind: "bulk_v1", id: 7 },
        extra: { list_id: "q4" },
        headers: { "x-extra": "yes" },
      }),
      result,
      { worker: { webhook: { secret } } },
      { sleep: noopSleep, logger: captureLogger() }
    );

    assert.ok(received.body, "server received body");
    const parsed = JSON.parse(received.body);
    assert.deepEqual(parsed.result, result);
    assert.deepEqual(parsed.extra, { list_id: "q4" });
    assert.equal(parsed.email, "alice@example.com");
    assert.deepEqual(parsed.jobId, { kind: "bulk_v1", id: 7 });
    assert.ok(parsed.taskId);

    const sigHeader = received.headers["x-webhook-signature"];
    assert.ok(sigHeader, "signature header present");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(received.body)
      .digest("hex");
    assert.equal(sigHeader, expected);

    assert.equal(received.headers["x-extra"], "yes");
    assert.match(received.headers["content-type"], /application\/json/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
