const test = require("node:test");
const assert = require("node:assert/strict");
const { checkMisc, isDisposableDomain } = require("../src/checker/misc");

test("disposable domain helper catches common disposable providers", () => {
  assert.equal(isDisposableDomain("tempmail.com"), true);
  assert.equal(isDisposableDomain("sub.mailinator.com"), true);
  assert.equal(isDisposableDomain("gmail.com"), false);
});

test("checkMisc marks known disposable domain as disposable", async () => {
  const out = await checkMisc(
    {
      address: "user@tempmail.com",
      username: "user",
      domain: "tempmail.com",
    },
    {}
  );
  assert.equal(out.is_disposable, true);
});
