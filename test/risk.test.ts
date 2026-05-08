// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateRiskScore } = require("../src/checker/checkEmail");

const goodSyntax = { is_valid_syntax: true };
const goodMx = { records: ["mx.example.com"], lookupError: null };
const goodSmtp = {
  can_connect_smtp: true,
  is_deliverable: true,
  is_disabled: false,
  has_full_inbox: false,
  is_catch_all: false,
};
const goodMisc = {
  is_disposable: false,
  is_role_account: false,
  haveibeenpwned: null,
  spf_present: true,
  dmarc_policy: "reject",
  dkim_selectors_found: ["default"],
};

test("invalid syntax pins score to 100", () => {
  const score = calculateRiskScore({
    syntax: { is_valid_syntax: false },
    misc: null,
    mx: null,
    smtpValue: null,
    smtpError: null,
  });
  assert.equal(score, 100);
});

test("clean valid+deliverable+SPF+DMARC scores 0", () => {
  const score = calculateRiskScore({
    syntax: goodSyntax,
    misc: goodMisc,
    mx: goodMx,
    smtpValue: goodSmtp,
    smtpError: null,
  });
  assert.equal(score, 0);
});

test("monotonicity: adding a bad signal never lowers the score", () => {
  const base = calculateRiskScore({
    syntax: goodSyntax,
    misc: goodMisc,
    mx: goodMx,
    smtpValue: goodSmtp,
    smtpError: null,
  });

  const withDisposable = calculateRiskScore({
    syntax: goodSyntax,
    misc: { ...goodMisc, is_disposable: true },
    mx: goodMx,
    smtpValue: goodSmtp,
    smtpError: null,
  });
  assert.ok(withDisposable >= base);

  const withCatchAll = calculateRiskScore({
    syntax: goodSyntax,
    misc: goodMisc,
    mx: goodMx,
    smtpValue: { ...goodSmtp, is_catch_all: true },
    smtpError: null,
  });
  assert.ok(withCatchAll >= base);

  const withRole = calculateRiskScore({
    syntax: goodSyntax,
    misc: { ...goodMisc, is_role_account: true },
    mx: goodMx,
    smtpValue: goodSmtp,
    smtpError: null,
  });
  assert.ok(withRole >= base);

  const withMissingSpf = calculateRiskScore({
    syntax: goodSyntax,
    misc: { ...goodMisc, spf_present: false },
    mx: goodMx,
    smtpValue: goodSmtp,
    smtpError: null,
  });
  assert.ok(withMissingSpf >= base);
});

test("score is clamped to [0, 100]", () => {
  const everything = calculateRiskScore({
    syntax: goodSyntax,
    misc: {
      is_disposable: true,
      is_role_account: true,
      haveibeenpwned: true,
      spf_present: false,
      dmarc_policy: null,
      dkim_selectors_found: [],
    },
    mx: { records: [], lookupError: { type: "ENODATA" } },
    smtpValue: {
      can_connect_smtp: false,
      is_deliverable: false,
      is_disabled: true,
      has_full_inbox: true,
      is_catch_all: true,
    },
    smtpError: null,
  });
  assert.equal(everything, 100);
});

test("greylist SMTP error is weighted lower than other SMTP errors", () => {
  const greylist = calculateRiskScore({
    syntax: goodSyntax,
    misc: goodMisc,
    mx: goodMx,
    smtpValue: null,
    smtpError: { description: "Greylisted" },
  });
  const generic = calculateRiskScore({
    syntax: goodSyntax,
    misc: goodMisc,
    mx: goodMx,
    smtpValue: null,
    smtpError: {},
  });
  assert.ok(greylist < generic);
});
