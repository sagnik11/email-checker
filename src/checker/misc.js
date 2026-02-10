const crypto = require("node:crypto");
const mailchecker = require("mailchecker");
const disposableEmailDomains = require("disposable-email-domains");
const { b2cSet, rolesSet } = require("./data");
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
          "User-Agent": "wq-email-checker-node",
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

  const [gravatarUrl, hibp] = await Promise.all([
    options.check_gravatar ? checkGravatar(email) : Promise.resolve(null),
    options.haveibeenpwned_api_key
      ? checkHaveIBeenPwned(email, options.haveibeenpwned_api_key)
      : Promise.resolve(null),
  ]);

  return {
    // Use both sources: `mailchecker` plus a larger disposable-domain list.
    is_disposable: !mailchecker.isValid(email) || isDisposableDomain(domain),
    is_role_account: rolesSet.has(username),
    is_b2c: b2cSet.has(domain),
    gravatar_url: gravatarUrl,
    haveibeenpwned: hibp,
  };
}

module.exports = {
  checkMisc,
  isDisposableDomain,
};
