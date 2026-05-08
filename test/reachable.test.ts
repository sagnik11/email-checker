// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkEmail } = require("../src/checker/checkEmail");

test("invalid syntax yields invalid reachability", async () => {
  const result = await checkEmail({ to_email: "foo" });
  assert.equal(result.is_reachable, "invalid");
  assert.equal(result.is_valid_syntax, false);
});

test("invalid syntax response carries new additive fields", async () => {
  const result = await checkEmail({ to_email: "foo" });
  // Bucket field is preserved (legacy contract).
  assert.equal(result.is_reachable, "invalid");
  // New fields exist and have safe defaults.
  assert.equal(typeof result.risk_score, "number");
  assert.equal(result.risk_score, 100);
  assert.equal(result.spf_present, false);
  assert.equal(result.dmarc_policy, null);
  assert.deepEqual(result.dkim_selectors_found, []);
  assert.equal(typeof result.email_domain_unicode, "string");
});
