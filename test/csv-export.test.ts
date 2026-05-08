// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { mapResultToCsvRow } = require("../src/http/app");

function baseResult(overrides = {}) {
  return {
    input: "user@example.com",
    is_reachable: "safe",
    email_address: "user@example.com",
    email_username: "user",
    email_domain: "example.com",
    is_valid_syntax: true,
    is_disposable_email: false,
    is_role_account: false,
    is_b2c_provider: false,
    gravatar_url: null,
    mx_accepts_mail: true,
    mx_preferred_host: "mx1.example.com",
    mx_lookup_error_message: null,
    smtp_can_connect: true,
    smtp_has_full_inbox: false,
    smtp_is_catch_all: false,
    smtp_is_deliverable: true,
    smtp_is_disabled_account: false,
    smtp_error_message: null,
    ...overrides,
  };
}

test("safe verdict maps every column from the flat result", () => {
  const row = mapResultToCsvRow(baseResult());
  assert.equal(row.input, "user@example.com");
  assert.equal(row.is_reachable, "safe");
  assert.equal(row.email_address, "user@example.com");
  assert.equal(row.email_username, "user");
  assert.equal(row.email_domain, "example.com");
  assert.equal(row.is_valid_syntax, true);
  assert.equal(row.is_disposable_email, false);
  assert.equal(row.is_role_account, false);
  assert.equal(row.mx_accepts_mail, true);
  assert.equal(row.mx_preferred_host, "mx1.example.com");
  assert.equal(row.smtp_can_connect, true);
  assert.equal(row.smtp_is_deliverable, true);
  assert.equal(row.error, null);
});

test("risky verdict surfaces disposable / role / catch-all flags", () => {
  const row = mapResultToCsvRow(
    baseResult({
      input: "admin@mailinator.com",
      is_reachable: "risky",
      email_username: "admin",
      email_domain: "mailinator.com",
      is_disposable_email: true,
      is_role_account: true,
      smtp_is_catch_all: true,
    })
  );
  assert.equal(row.is_reachable, "risky");
  assert.equal(row.is_disposable_email, true);
  assert.equal(row.is_role_account, true);
  assert.equal(row.smtp_is_catch_all, true);
  assert.equal(row.smtp_is_deliverable, true);
  assert.equal(row.error, null);
});

test("invalid verdict reports undeliverable smtp without an error message", () => {
  const row = mapResultToCsvRow(
    baseResult({
      input: "ghost@example.com",
      is_reachable: "invalid",
      email_username: "ghost",
      smtp_is_deliverable: false,
      smtp_can_connect: true,
    })
  );
  assert.equal(row.is_reachable, "invalid");
  assert.equal(row.smtp_is_deliverable, false);
  assert.equal(row.smtp_can_connect, true);
  assert.equal(row.error, null);
});

test("unknown verdict surfaces smtp_error_message in the error column", () => {
  const row = mapResultToCsvRow(
    baseResult({
      input: "blocked@example.com",
      is_reachable: "unknown",
      smtp_can_connect: false,
      smtp_is_deliverable: false,
      smtp_error_message: "connection refused",
    })
  );
  assert.equal(row.is_reachable, "unknown");
  assert.equal(row.smtp_can_connect, false);
  assert.equal(row.error, "connection refused");
});

test("error column falls back to mx lookup error then top-level error", () => {
  const mxOnly = mapResultToCsvRow(
    baseResult({
      smtp_error_message: null,
      mx_lookup_error_message: "NXDOMAIN",
    })
  );
  assert.equal(mxOnly.error, "NXDOMAIN");

  const topLevel = mapResultToCsvRow(
    baseResult({
      smtp_error_message: null,
      mx_lookup_error_message: null,
      error: "checker crashed",
    })
  );
  assert.equal(topLevel.error, "checker crashed");
});

test("empty result does not throw and returns sane defaults", () => {
  const row = mapResultToCsvRow({});
  assert.equal(row.input, "");
  assert.equal(row.is_reachable, "");
  assert.equal(row.email_address, "");
  assert.equal(row.is_valid_syntax, false);
  assert.equal(row.is_disposable_email, false);
  assert.equal(row.mx_accepts_mail, false);
  assert.equal(row.mx_preferred_host, null);
  assert.equal(row.smtp_is_deliverable, false);
  assert.equal(row.gravatar_url, null);
  assert.equal(row.error, null);
});

test("null input is handled without throwing", () => {
  const row = mapResultToCsvRow(null);
  assert.equal(row.input, "");
  assert.equal(row.is_reachable, "");
  assert.equal(row.error, null);
});
