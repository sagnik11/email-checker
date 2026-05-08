// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkSyntax, normalizeEmail, getSimilarMailProvider } = require("../src/checker/syntax");

test("normalize gmail removes dots and plus", () => {
  assert.equal(normalizeEmail("A.B.C+123", "googlemail.com"), "abc@gmail.com");
});

test("invalid syntax for malformed input", () => {
  const syntax = checkSyntax("foo");
  assert.equal(syntax.is_valid_syntax, false);
  assert.equal(syntax.address, null);
});

test("valid syntax for standard address", () => {
  const syntax = checkSyntax("foo@bar.com");
  assert.equal(syntax.is_valid_syntax, true);
  assert.equal(syntax.domain, "bar.com");
  assert.equal(syntax.username, "foo");
});

test("suggest provider for close typo", () => {
  const syntax = checkSyntax("test@gmali.com");
  getSimilarMailProvider(syntax);
  assert.equal(syntax.suggestion, "test@gmail.com");
});

test("normalizes IDN domain to punycode (xn--) form", () => {
  const syntax = checkSyntax("info@münchen.de");
  assert.equal(syntax.is_valid_syntax, true);
  assert.equal(syntax.domain, "xn--mnchen-3ya.de");
  assert.equal(syntax.domain_unicode, "münchen.de");
  assert.equal(syntax.address, "info@xn--mnchen-3ya.de");
});

test("ASCII domain stays ASCII and exposes unicode mirror", () => {
  const syntax = checkSyntax("foo@bar.com");
  assert.equal(syntax.domain, "bar.com");
  assert.equal(syntax.domain_unicode, "bar.com");
});
