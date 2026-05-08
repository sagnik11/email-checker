// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isInvalidError,
  isFullInboxError,
  isDisabledAccountError,
  isGreylistError,
} = require("../src/checker/smtpParser");

test("invalid error parser detects unknown user", () => {
  assert.equal(isInvalidError("550 5.1.1 User unknown", "foo@bar.com"), true);
});

test("full inbox parser detects quota errors", () => {
  assert.equal(isFullInboxError("552 mailbox full"), true);
});

test("disabled parser detects disabled accounts", () => {
  assert.equal(isDisabledAccountError("This account has been disabled"), true);
});

test("greylist parser detects 4xx greylist messages", () => {
  assert.equal(isGreylistError(450, "4.7.1 Please try again later"), true);
  assert.equal(isGreylistError(451, "Greylisted, please retry"), true);
  assert.equal(isGreylistError(452, "Temporary failure, try later"), true);
  // Bare 421 service-unavailable is also treated as greylist (worker re-probes once).
  assert.equal(isGreylistError(421, "Service not available"), true);
});

test("greylist parser ignores 5xx and unrelated messages", () => {
  assert.equal(isGreylistError(550, "5.1.1 user unknown"), false);
  assert.equal(isGreylistError(250, "ok"), false);
  // 421 with explicit blacklist text shouldn't be treated as greylist.
  assert.equal(isGreylistError(421, "blacklisted by spamhaus"), false);
});
