// @ts-nocheck
const url = require("node:url");
const IsEmail = require("isemail");
const { levenshtein } = require("./util");

const MAIL_PROVIDERS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "protonmail.com",
  "icloud.com",
  "yandex.com",
];

function toAsciiDomain(domain) {
  const raw = String(domain || "").trim();
  if (!raw) return "";
  // Pure-ASCII domains short-circuit (avoids Node's URL ASCII-validation quirks)
  if (/^[\x00-\x7f]+$/.test(raw)) {
    return raw.toLowerCase();
  }
  try {
    const ascii = url.domainToASCII(raw);
    return ascii ? ascii.toLowerCase() : "";
  } catch (_) {
    return "";
  }
}

function normalizeEmail(username, domain) {
  const d = String(domain || "").toLowerCase();

  if (d === "gmail.com" || d === "googlemail.com") {
    const local = String(username || "")
      .split("+")[0]
      .toLowerCase()
      .replace(/\./g, "");
    return `${local}@gmail.com`;
  }

  return `${username}@${domain}`;
}

function invalidSyntaxDetails() {
  return {
    address: null,
    domain: "",
    domain_unicode: "",
    is_valid_syntax: false,
    username: "",
    normalized_email: null,
    suggestion: null,
  };
}

function checkSyntax(emailAddress) {
  const email = String(emailAddress || "").trim();
  const isValid = IsEmail.validate(email, { allowUnicode: true });

  if (!isValid) {
    return invalidSyntaxDetails();
  }

  const atIdx = email.lastIndexOf("@");
  if (atIdx <= 0 || atIdx === email.length - 1) {
    return invalidSyntaxDetails();
  }

  const username = email.slice(0, atIdx);
  const domainUnicode = email.slice(atIdx + 1);
  const domainAscii = toAsciiDomain(domainUnicode);

  if (!domainAscii) {
    return invalidSyntaxDetails();
  }

  // Canonical address used everywhere downstream (DNS, SMTP, cache key) is the
  // ASCII-domain form. The original unicode form is preserved separately for
  // display in `domain_unicode`.
  const canonicalAddress = `${username}@${domainAscii}`;

  return {
    address: canonicalAddress,
    domain: domainAscii,
    domain_unicode: domainUnicode,
    is_valid_syntax: true,
    username,
    normalized_email: normalizeEmail(username, domainAscii),
    suggestion: null,
  };
}

function getSimilarMailProvider(syntax) {
  if (!syntax || !syntax.domain || !syntax.username) {
    return;
  }

  const domain = String(syntax.domain).toLowerCase();
  for (const provider of MAIL_PROVIDERS) {
    if (levenshtein(domain, provider) < 3) {
      syntax.suggestion = `${syntax.username}@${provider}`;
      return;
    }
  }
}

module.exports = {
  checkSyntax,
  getSimilarMailProvider,
  normalizeEmail,
  toAsciiDomain,
};
