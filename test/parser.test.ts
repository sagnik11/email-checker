// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isInvalidError,
  isFullInboxError,
  isDisabledAccountError,
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
