// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  checkMisc,
  hasSpfRecord,
  isDisposableDomain,
  looksLikeDkim,
  parseDmarcPolicy,
} = require("../src/checker/misc");

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

test("checkMisc returns mail-auth shape (spf/dmarc/dkim) even on lookup failure", async () => {
  const out = await checkMisc(
    {
      address: "user@nonexistent-test-domain.invalid",
      username: "user",
      domain: "nonexistent-test-domain.invalid",
    },
    {}
  );
  // Failures must yield falsy values, not crash. Domain can't resolve so
  // SPF/DMARC/DKIM should all be empty/null.
  assert.equal(out.spf_present, false);
  assert.equal(out.dmarc_policy, null);
  assert.deepEqual(out.dkim_selectors_found, []);
});

test("hasSpfRecord recognizes v=spf1 records", () => {
  assert.equal(hasSpfRecord(["v=spf1 include:_spf.google.com ~all"]), true);
  assert.equal(hasSpfRecord(["something else"]), false);
  assert.equal(hasSpfRecord(null), false);
});

test("parseDmarcPolicy extracts p= tag", () => {
  assert.equal(
    parseDmarcPolicy(["v=DMARC1; p=quarantine; rua=mailto:foo@bar.com"]),
    "quarantine"
  );
  assert.equal(parseDmarcPolicy(["v=DMARC1; p=reject"]), "reject");
  assert.equal(parseDmarcPolicy(["v=DMARC1; p=none"]), "none");
  assert.equal(parseDmarcPolicy(["v=DMARC1;"]), null);
  assert.equal(parseDmarcPolicy(["not a dmarc record"]), null);
});

test("looksLikeDkim detects DKIM-flavored TXT records", () => {
  assert.equal(looksLikeDkim(["v=DKIM1; k=rsa; p=MIGfMA0..."]), true);
  assert.equal(looksLikeDkim(["k=rsa; p=MIGfMA0..."]), true);
  assert.equal(looksLikeDkim(["v=spf1 ~all"]), false);
  assert.equal(looksLikeDkim(null), false);
});
