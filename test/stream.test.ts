// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("../src/http/app");

function buildRuntime() {
  return {
    config: {
      header_secret: "",
      allow_browser_without_secret: true,
      cors: { origins: ["*"] },
      worker: { enable: false },
      storage: { type: "memory" },
    },
    throttle: {
      checkThrottle: () => null,
      incrementCounters: () => {},
    },
    storage: {
      store: async () => {},
      getExtra: () => ({}),
    },
    rabbit: { conn: null, channel: null },
  };
}

function startServer() {
  const app = createApp(buildRuntime());
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function parseSseChunk(buffer) {
  const events = [];
  const blocks = buffer.split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l && !l.startsWith(":"));
    if (lines.length === 0) continue;
    let event = null;
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (event) events.push({ event, data });
  }
  return events;
}

function getStream(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("stream endpoint emits syntax then done for invalid input", async () => {
  const { server, port } = await startServer();
  try {
    const { status, headers, body } = await getStream(
      port,
      "/v1/check_email/stream?email=foo"
    );
    assert.equal(status, 200);
    assert.match(String(headers["content-type"] || ""), /text\/event-stream/);

    const events = parseSseChunk(body);
    const stages = events.map((e) => e.event);
    assert.equal(stages[0], "syntax", `first stage was ${stages[0]}`);
    assert.equal(stages[stages.length - 1], "done", `last stage was ${stages[stages.length - 1]}`);
    // Invalid syntax skips MX/SMTP entirely.
    assert.ok(!stages.includes("mx"), "mx should not be emitted for invalid syntax");
    assert.ok(!stages.includes("smtp_connect"), "smtp_connect should not be emitted for invalid syntax");

    const doneEvent = events.find((e) => e.event === "done");
    const result = JSON.parse(doneEvent.data);
    assert.equal(result.is_reachable, "invalid");
    assert.equal(result.is_valid_syntax, false);
  } finally {
    await stopServer(server);
  }
});

test("stream endpoint rejects request with missing email parameter", async () => {
  const { server, port } = await startServer();
  try {
    const { status, body } = await getStream(port, "/v1/check_email/stream");
    assert.equal(status, 400);
    const parsed = JSON.parse(body);
    assert.match(String(parsed.error), /email/);
  } finally {
    await stopServer(server);
  }
});

test("stream events deserialize as JSON payloads", async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await getStream(
      port,
      "/v1/check_email/stream?email=not-an-email"
    );
    const events = parseSseChunk(body);
    for (const evt of events) {
      assert.doesNotThrow(() => JSON.parse(evt.data),
        `event "${evt.event}" data was not valid JSON: ${evt.data}`);
    }
  } finally {
    await stopServer(server);
  }
});
