// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { dedupeEmails, canonicalizeEmail } = require("../src/worker/service");

test("dedupeEmails collapses casing and whitespace variants", () => {
  const { uniqueEmails, originalInputs } = dedupeEmails([
    "A@b.com",
    "a@b.com",
    " A@B.com ",
    "x@y.com",
  ]);

  assert.deepEqual(uniqueEmails, ["a@b.com", "x@y.com"]);
  assert.deepEqual(originalInputs, ["A@b.com", "a@b.com", " A@B.com ", "x@y.com"]);
});

test("dedupeEmails skips empty and nullish entries", () => {
  const { uniqueEmails, originalInputs } = dedupeEmails([
    "",
    "   ",
    null,
    undefined,
    "alice@example.com",
  ]);

  assert.deepEqual(uniqueEmails, ["alice@example.com"]);
  assert.deepEqual(originalInputs, ["alice@example.com"]);
});

test("dedupeEmails preserves first-seen unique order", () => {
  const { uniqueEmails } = dedupeEmails([
    "c@x.com",
    "a@x.com",
    "B@X.COM",
    "a@x.com",
    "C@x.com",
  ]);

  assert.deepEqual(uniqueEmails, ["c@x.com", "a@x.com", "b@x.com"]);
});

test("dedupeEmails returns empty result for non-array input", () => {
  const result = dedupeEmails(undefined);
  assert.deepEqual(result, { uniqueEmails: [], originalInputs: [] });
});

test("canonicalizeEmail trims and lowercases", () => {
  assert.equal(canonicalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
  assert.equal(canonicalizeEmail(undefined), "");
});
