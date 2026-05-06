// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkEmail } = require("../src/checker/checkEmail");

test("invalid syntax yields invalid reachability", async () => {
  const result = await checkEmail({ to_email: "foo" });
  assert.equal(result.is_reachable, "invalid");
  assert.equal(result.syntax.is_valid_syntax, false);
});
