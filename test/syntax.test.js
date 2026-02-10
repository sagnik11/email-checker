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
