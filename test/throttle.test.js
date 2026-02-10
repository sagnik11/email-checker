const test = require("node:test");
const assert = require("node:assert/strict");
const { ThrottleManager } = require("../src/throttle");

test("throttle triggers after configured per-second limit", () => {
  const manager = new ThrottleManager({ max_requests_per_second: 1 });

  assert.equal(manager.checkThrottle(), null);
  manager.incrementCounters();

  const throttled = manager.checkThrottle();
  assert.ok(throttled);
  assert.equal(throttled.limit_type, "per second");
});
