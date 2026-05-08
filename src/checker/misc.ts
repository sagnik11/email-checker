// @ts-nocheck
const crypto = require("node:crypto");
const dns = require("node:dns/promises");
const mailchecker = require("mailchecker");
const disposableEmailDomains = require("disposable-email-domains");
const { b2cSet, rolesSet } = require("./data");

const DKIM_SELECTORS = [
  "default",
  "google",
  "selector1",
  "selector2",
  "k1",
  "k2",
  "mail",
  "dkim",
  "s1",
  "s2",
  "mandrill",
  "mxvault",
];

const TXT_TIMEOUT_MS = 5000;
const manualDisposableDomains = new Set([
  // Keep a small override set for common disposable domains that may be
  // missing from upstream lists.
  "tempmail.com",
  "temp-mail.org",
  "tempmail.org",
  "yopmail.com",
]);
const disposableDomainSet = new Set(
  disposableEmailDomains.map((domain) => String(domain).toLowerCase())
);

function isDisposableDomain(domain) {
  let candidate = String(domain || "").toLowerCase().trim();
  if (!candidate) {
    return false;
  }

  // Match both exact domains and nested subdomains.
  while (candidate.includes(".")) {
    if (disposableDomainSet.has(candidate) || manualDisposableDomains.has(candidate)) {
      return true;
    }
    candidate = candidate.slice(candidate.indexOf(".") + 1);
  }

  return disposableDomainSet.has(candidate) || manualDisposableDomains.has(candidate);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("dns timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function resolveTxtSafe(name, timeoutMs = TXT_TIMEOUT_MS) {
  try {
    const records = await withTimeout(dns.resolveTxt(name), timeoutMs);
    return records.map((chunks) => chunks.join(""));
  } catch (_) {
    return null;
  }
}

function parseDmarcPolicy(records) {
  if (!Array.isArray(records)) return null;
  for (const record of records) {
    const lower = String(record || "").trim().toLowerCase();
    if (!lower.startsWith("v=dmarc1")) continue;
    const match = lower.match(/p\s*=\s*([a-z]+)/);
    if (match && ["none", "quarantine", "reject"].includes(match[1])) {
      return match[1];
    }
    return null;
  }
  return null;
}

function hasSpfRecord(records) {
  if (!Array.isArray(records)) return false;
  return records.some((record) =>
    String(record || "").trim().toLowerCase().startsWith("v=spf1")
  );
}

function looksLikeDkim(records) {
  if (!Array.isArray(records)) return false;
  return records.some((record) => {
    const lower = String(record || "").toLowerCase();
    return lower.includes("v=dkim1") || lower.includes("k=rsa") || lower.includes("p=");
  });
}

async function checkMailAuth(domain) {
  const target = String(domain || "").toLowerCase().trim();
  if (!target) {
    return {
      spf_present: false,
      dmarc_policy: null,
      dkim_selectors_found: [],
    };
  }

  const dkimNames = DKIM_SELECTORS.map((selector) => `${selector}._domainkey.${target}`);

  const [spfRes, dmarcRes, ...dkimResults] = await Promise.all([
    resolveTxtSafe(target),
    resolveTxtSafe(`_dmarc.${target}`),
    ...dkimNames.map((name) => resolveTxtSafe(name)),
  ]);

  const dkimHits = [];
  for (let i = 0; i < DKIM_SELECTORS.length; i += 1) {
    if (looksLikeDkim(dkimResults[i])) {
      dkimHits.push(DKIM_SELECTORS[i]);
    }
  }

  return {
    spf_present: hasSpfRecord(spfRes),
    dmarc_policy: parseDmarcPolicy(dmarcRes),
    dkim_selectors_found: dkimHits,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkGravatar(email) {
  const hash = crypto.createHash("md5").update(String(email)).digest("hex");
  const url = `https://www.gravatar.com/avatar/${hash}`;

  try {
    const response = await fetchWithTimeout(`${url}?d=404`, {}, 6000);
    return response.status === 200 ? url : null;
  } catch (_) {
    return null;
  }
}

async function checkHaveIBeenPwned(email, apiKey) {
  if (!apiKey) {
    return null;
  }

  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(
    email
  )}?truncateResponse=false`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": "email-validation-service",
          "hibp-api-key": apiKey,
        },
      },
      10000
    );

    if (response.ok) {
      const breaches = await response.json();
      return Array.isArray(breaches) ? breaches.length > 0 : false;
    }

    if (response.status === 404) {
      return false;
    }

    return null;
  } catch (_) {
    return null;
  }
}

async function checkMisc(syntax, options = {}) {
  const email = syntax.address;
  const username = String(syntax.username || "").toLowerCase();
  const domain = String(syntax.domain || "").toLowerCase();

  const [gravatarUrl, hibp, mailAuth] = await Promise.all([
    options.check_gravatar ? checkGravatar(email) : Promise.resolve(null),
    options.haveibeenpwned_api_key
      ? checkHaveIBeenPwned(email, options.haveibeenpwned_api_key)
      : Promise.resolve(null),
    checkMailAuth(domain),
  ]);

  return {
    // Use both sources: `mailchecker` plus a larger disposable-domain list.
    is_disposable: !mailchecker.isValid(email) || isDisposableDomain(domain),
    is_role_account: rolesSet.has(username),
    is_b2c: b2cSet.has(domain),
    gravatar_url: gravatarUrl,
    haveibeenpwned: hibp,
    spf_present: mailAuth.spf_present,
    dmarc_policy: mailAuth.dmarc_policy,
    dkim_selectors_found: mailAuth.dkim_selectors_found,
  };
}

module.exports = {
  checkMailAuth,
  checkMisc,
  hasSpfRecord,
  isDisposableDomain,
  looksLikeDkim,
  parseDmarcPolicy,
};
