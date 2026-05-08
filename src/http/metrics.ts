// @ts-nocheck
const client = require("prom-client");
const {
  isDisabledAccountError,
  isFullInboxError,
  isInvalidError,
  isIpBlacklistedError,
  isNeedsRdnsError,
} = require("../checker/smtpParser");

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const checkEmailTotal = new client.Counter({
  name: "check_email_total",
  help: "Total email checks completed, labeled by reachability verdict.",
  labelNames: ["verdict"],
  registers: [registry],
});

const checkEmailDuration = new client.Histogram({
  name: "check_email_duration_seconds",
  help: "Duration of email check operations in seconds.",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

const bulkJobActive = new client.Gauge({
  name: "bulk_job_active",
  help: "Number of bulk-queue email checks currently in flight on this worker.",
  registers: [registry],
});

const smtpErrorsTotal = new client.Counter({
  name: "smtp_errors_total",
  help: "Total SMTP errors observed during checks, labeled by classified reason.",
  labelNames: ["reason"],
  registers: [registry],
});

const VALID_VERDICTS = new Set(["safe", "risky", "invalid", "unknown"]);

function recordVerdict(verdict) {
  const v = VALID_VERDICTS.has(verdict) ? verdict : "unknown";
  checkEmailTotal.inc({ verdict: v });
}

function classifySmtpReason(message, email) {
  const m = String(message || "");
  if (!m) return "other";
  if (isInvalidError(m, email)) return "invalid";
  if (isFullInboxError(m)) return "full_inbox";
  if (isDisabledAccountError(m)) return "disabled";
  if (isIpBlacklistedError(m)) return "ip_blacklisted";
  if (isNeedsRdnsError(m)) return "needs_rdns";
  return "other";
}

function recordSmtpError(message, email) {
  smtpErrorsTotal.inc({ reason: classifySmtpReason(message, email) });
}

module.exports = {
  registry,
  checkEmailTotal,
  checkEmailDuration,
  bulkJobActive,
  smtpErrorsTotal,
  recordVerdict,
  recordSmtpError,
  classifySmtpReason,
};
