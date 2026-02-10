function containsAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function isInvalidError(message, email) {
  const e = String(message || "").toLowerCase();
  const emailLower = String(email || "").toLowerCase();

  const patterns = [
    "address rejected",
    "unrouteable",
    "does not exist",
    "invalid address",
    "invalid email address",
    "invalid recipient",
    "may not exist",
    "recipient invalid",
    "recipient rejected",
    "unknown recipient address",
    "unknown recipient",
    "undeliverable",
    "user unknown",
    "unknown user",
    "recipient unknown",
    "no such user",
    "mailbox not found",
    "invalid mailbox",
    "no mailbox",
    "no such mailbox",
    "mailbox unavailable",
    "mailbox is unavailable",
    "not a valid mailbox",
    "no such recipient",
    "have an account",
    "unknown local part",
    "no longer available",
    "dosn't exist",
    "could not be found",
    "no such person",
    "address error",
    "address is not handled",
    "recipient is not exist",
    "recipient not found",
    "email doesn't exist",
    "verify address failed",
    "unable to verify user",
    "utilisateur inconnu",
    "permanent: 5.1.1",
    "permanent: 5.7.1",
  ];

  if (containsAny(e, patterns)) {
    return true;
  }

  if (emailLower && e.includes(`mailbox ${emailLower} unknown`)) {
    return true;
  }

  return false;
}

function isFullInboxError(message) {
  const e = String(message || "").toLowerCase();
  return containsAny(e, [
    "insufficient",
    "mailbox full",
    "quota exceeded",
    "quote exceeded",
    "over quota",
    "too many messages",
    "out of storage space",
  ]);
}

function isDisabledAccountError(message) {
  const e = String(message || "").toLowerCase();
  return containsAny(e, ["disabled", "discontinued", "inactive"]);
}

function isIpBlacklistedError(message) {
  const e = String(message || "").toLowerCase();
  return containsAny(e, [
    "blacklist",
    "black list",
    "block list",
    "spam",
    "abusix",
    "relaying denied",
    "access denied",
    "administratively denied",
    "banned",
    "blocked",
    "connection rejected",
    "poor reputation",
    "junkmail",
    "proofpoint",
    "dnsbl",
    "sbrs score too low",
    "spamhaus",
    "relay not permitted",
    "not yet authorized",
  ]);
}

function isNeedsRdnsError(message) {
  const e = String(message || "").toLowerCase();
  return containsAny(e, ["cannot find your reverse hostname", "reverse dns entry"]);
}

module.exports = {
  isDisabledAccountError,
  isFullInboxError,
  isInvalidError,
  isIpBlacklistedError,
  isNeedsRdnsError,
};
