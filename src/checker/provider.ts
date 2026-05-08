// @ts-nocheck
const { rules } = require("./data");
const { normalizeMxHost } = require("./rules");

function isGmail(mxHost) {
  return String(mxHost || "").toLowerCase().endsWith(".google.com.");
}

function isHotmail(mxHost) {
  return String(mxHost || "").toLowerCase().endsWith(".protection.outlook.com.");
}

function isHotmailB2B(mxHost) {
  const host = String(mxHost || "").toLowerCase();
  return isHotmail(host) && !host.endsWith(".olc.protection.outlook.com.");
}

function isHotmailB2C(mxHost) {
  const host = String(mxHost || "").toLowerCase();
  return isHotmail(host) && host.endsWith(".olc.protection.outlook.com.");
}

function isMimecast(mxHost) {
  return String(mxHost || "").toLowerCase().endsWith(".mimecast.com.");
}

function isProofpoint(mxHost) {
  const host = String(mxHost || "").toLowerCase();
  return host.endsWith(".pphosted.com.") || host.endsWith("ppe-hosted.com.");
}

function isYahoo(mxHost) {
  return String(mxHost || "").toLowerCase().endsWith(".yahoodns.net.");
}

function providerFromRulesByMx(mxHost) {
  const map = rules?.providers?.by_mx_suffix;
  if (!map) return null;
  const normalized = normalizeMxHost(mxHost);
  for (const [suffix, name] of Object.entries(map)) {
    if (normalized.endsWith(suffix)) {
      return String(name);
    }
  }
  return null;
}

function providerFromMx(mxHost) {
  if (isHotmailB2C(mxHost)) return "hotmailb2c";
  if (isHotmailB2B(mxHost)) return "hotmailb2b";
  if (isGmail(mxHost)) return "gmail";
  if (isYahoo(mxHost)) return "yahoo";
  if (isProofpoint(mxHost)) return "proofpoint";
  if (isMimecast(mxHost)) return "mimecast";
  const fromRules = providerFromRulesByMx(mxHost);
  if (fromRules) return fromRules;
  return "everything_else";
}

function providerFromDomain(domain) {
  const map = rules?.providers?.by_domain;
  if (!map) return null;
  const d = String(domain || "").toLowerCase().trim();
  if (!d) return null;
  return map[d] ? String(map[d]) : null;
}

module.exports = {
  isGmail,
  isHotmail,
  isHotmailB2B,
  isHotmailB2C,
  isMimecast,
  isProofpoint,
  isYahoo,
  providerFromDomain,
  providerFromMx,
};
