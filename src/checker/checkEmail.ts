// @ts-nocheck
const { checkSyntax, getSimilarMailProvider } = require("./syntax");
const { checkMx } = require("./mx");
const { checkMisc } = require("./misc");
const { Rule, hasRule } = require("./rules");
const { buildDefaultSmtpDetails, checkSmtp } = require("./smtp");
const { providerFromDomain, providerFromMx } = require("./provider");
const { durationFromMs } = require("./util");

function flattenSyntax(syntax) {
  return {
    email_address: syntax.address,
    email_username: syntax.username,
    email_domain: syntax.domain,
    email_domain_unicode: syntax.domain_unicode || syntax.domain || "",
    normalized_email: syntax.normalized_email,
    is_valid_syntax: syntax.is_valid_syntax,
    syntax_suggestion: syntax.suggestion,
  };
}

function flattenMisc(misc) {
  if (!misc) {
    return {
      is_disposable_email: false,
      is_role_account: false,
      is_b2c_provider: false,
      gravatar_url: null,
      has_been_pwned: null,
      spf_present: false,
      dmarc_policy: null,
      dkim_selectors_found: [],
    };
  }
  return {
    is_disposable_email: misc.is_disposable,
    is_role_account: misc.is_role_account,
    is_b2c_provider: misc.is_b2c,
    gravatar_url: misc.gravatar_url,
    has_been_pwned: misc.haveibeenpwned,
    spf_present: Boolean(misc.spf_present),
    dmarc_policy: misc.dmarc_policy ?? null,
    dkim_selectors_found: Array.isArray(misc.dkim_selectors_found)
      ? misc.dkim_selectors_found
      : [],
  };
}

function flattenMx({ accepts_mail, records, preferred, lookupError } = {}) {
  return {
    mx_accepts_mail: Boolean(accepts_mail),
    mx_records: Array.isArray(records) ? records : [],
    mx_preferred_host: preferred?.exchange || null,
    mx_preferred_priority:
      typeof preferred?.priority === "number" ? preferred.priority : null,
    mx_lookup_error_type: lookupError?.type || null,
    mx_lookup_error_message: lookupError?.message || null,
  };
}

function flattenSmtp(smtpValue, smtpError) {
  if (smtpError) {
    return {
      smtp_can_connect: false,
      smtp_has_full_inbox: false,
      smtp_is_catch_all: false,
      smtp_is_deliverable: false,
      smtp_is_disabled_account: false,
      smtp_error_type: smtpError.error?.type || null,
      smtp_error_message: smtpError.error?.message || null,
      smtp_error_description: smtpError.description || null,
    };
  }

  const value = smtpValue || buildDefaultSmtpDetails();
  return {
    smtp_can_connect: Boolean(value.can_connect_smtp),
    smtp_has_full_inbox: Boolean(value.has_full_inbox),
    smtp_is_catch_all: Boolean(value.is_catch_all),
    smtp_is_deliverable: Boolean(value.is_deliverable),
    smtp_is_disabled_account: Boolean(value.is_disabled),
    smtp_error_type: null,
    smtp_error_message: null,
    smtp_error_description: null,
  };
}

function flattenDebug({ backendName, startTime, endTime, startTimeMs, verifMethod }) {
  const durationMs = endTime.getTime() - startTimeMs;
  const duration = durationFromMs(durationMs);

  return {
    backend_name: backendName,
    check_started_at: startTime.toISOString(),
    check_completed_at: endTime.toISOString(),
    check_duration_ms: durationMs,
    check_duration_seconds: duration.secs,
    check_duration_nanos: duration.nanos,
    verification_method_type: verifMethod.type || "skipped",
    verification_method_host: verifMethod.host || null,
    verification_method_smtp_port:
      typeof verifMethod.smtp_port === "number" ? verifMethod.smtp_port : null,
    verification_method_provider: verifMethod.provider || null,
    verification_method_chosen: verifMethod.method || null,
    verification_method_requested: verifMethod.requested_method || null,
    verification_method_fallback: verifMethod.fallback_to || null,
  };
}

function calculateReachable(misc, smtpValue, smtpError) {
  if (smtpError) {
    return "unknown";
  }

  if (
    misc.is_disposable ||
    misc.is_role_account ||
    smtpValue.is_catch_all ||
    smtpValue.has_full_inbox
  ) {
    return "risky";
  }

  if (
    !smtpValue.is_deliverable ||
    !smtpValue.can_connect_smtp ||
    smtpValue.is_disabled
  ) {
    return "invalid";
  }

  return "safe";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Weighted additive risk score in [0, 100]. Higher = more risky / less likely
// to deliver. The bucket field `is_reachable` is computed independently by
// `calculateReachable()` so this score is purely additive for callers that
// want a finer-grained signal.
function calculateRiskScore({ syntax, misc, mx, smtpValue, smtpError }) {
  if (syntax && syntax.is_valid_syntax === false) {
    return 100;
  }

  let score = 0;

  if (mx) {
    if (mx.lookupError) score += 60;
    if (Array.isArray(mx.records) && mx.records.length === 0) score += 90;
  }

  if (smtpError) {
    const description = smtpError.description;
    if (description === "Greylisted") {
      score += 25;
    } else {
      score += 35;
    }
  } else if (smtpValue) {
    if (smtpValue.is_deliverable === false) score += 80;
    if (smtpValue.is_disabled) score += 70;
    if (smtpValue.has_full_inbox) score += 30;
    if (smtpValue.is_catch_all) score += 25;
    if (smtpValue.can_connect_smtp === false) score += 40;
  }

  if (misc) {
    if (misc.is_disposable) score += 40;
    if (misc.is_role_account) score += 15;
    if (misc.haveibeenpwned === true) score += 10;
    if (misc.spf_present === false) score += 5;
    if (!misc.dmarc_policy || misc.dmarc_policy === "none") score += 5;
    if (
      Array.isArray(misc.dkim_selectors_found) &&
      misc.dkim_selectors_found.length === 0
    ) {
      score += 3;
    }
  }

  return clamp(Math.round(score), 0, 100);
}

function resolveSmtpTimeoutMs(input, hasTimeoutRule) {
  let timeoutMs;

  if (typeof input.smtp_timeout_ms === "number") {
    timeoutMs = input.smtp_timeout_ms;
  } else if (typeof input.smtp_timeout === "number") {
    timeoutMs = input.smtp_timeout * 1000;
  } else {
    timeoutMs = 15000;
  }

  if (hasTimeoutRule) {
    timeoutMs = Math.max(timeoutMs, 45000);
  }

  return timeoutMs;
}

function chosenMethodForProvider(provider, input) {
  if (provider === "yahoo") {
    return input.yahoo_verif_method || "smtp";
  }

  if (provider === "hotmailb2c") {
    return input.hotmailb2c_verif_method || "smtp";
  }

  return "smtp";
}

function buildResult({
  input,
  isReachable,
  syntax,
  misc,
  mx,
  smtpValue,
  smtpError,
  debug,
}) {
  const riskScore = calculateRiskScore({ syntax, misc, mx, smtpValue, smtpError });
  return {
    input,
    is_reachable: isReachable,
    risk_score: riskScore,
    ...flattenSyntax(syntax),
    ...flattenMisc(misc),
    ...flattenMx(mx),
    ...flattenSmtp(smtpValue, smtpError),
    ...flattenDebug(debug),
  };
}

async function checkEmail(rawInput = {}, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const emit = (stage, payload) => {
    if (!onProgress) return;
    try { onProgress(stage, payload); } catch (_) {}
  };
  const startTimeMs = Date.now();
  const startTime = new Date(startTimeMs);
  const allowGreylistRetry = Boolean(options.allowGreylistRetry);
  const greylistRetryMs =
    typeof options.greylistRetryMs === "number" && options.greylistRetryMs >= 0
      ? options.greylistRetryMs
      : 60000;

  // Env var always wins so cloud providers that block port 25 can override via EMAIL_CHECKER_SMTP_PORT=587
  const effectiveSmtpPort = Number(process.env.EMAIL_CHECKER_SMTP_PORT || rawInput.smtp_port || 25);

  console.log(JSON.stringify({
    ts: startTime.toISOString(),
    level: "info",
    source: "checkEmail",
    msg: "check started",
    to_email: String(rawInput.to_email || "").trim(),
    smtp_port: effectiveSmtpPort,
    node_version: process.version,
    platform: process.platform,
    env_smtp_port: process.env.EMAIL_CHECKER_SMTP_PORT || "(not set, defaulting to 25)",
    client_requested_port: rawInput.smtp_port ?? "(not sent)",
  }));

  const input = {
    to_email: String(rawInput.to_email || "").trim(),
    from_email:
      rawInput.from_email || process.env.EMAIL_CHECKER_FROM_EMAIL || "noreply@example.com",
    hello_name:
      rawInput.hello_name || process.env.EMAIL_CHECKER_HELLO_NAME || "example.com",
    smtp_port: effectiveSmtpPort,
    retries: Number(rawInput.retries || 1),
    proxy: rawInput.proxy || null,
    check_gravatar: Boolean(rawInput.check_gravatar),
    haveibeenpwned_api_key:
      rawInput.haveibeenpwned_api_key || process.env.EMAIL_CHECKER_HIBP_API_KEY || null,
    backend_name:
      rawInput.backend_name || process.env.EMAIL_CHECKER_BACKEND_NAME || "backend-dev",
    smtp_timeout_ms:
      typeof rawInput.smtp_timeout_ms === "number"
        ? rawInput.smtp_timeout_ms
        : undefined,
    smtp_timeout:
      typeof rawInput.smtp_timeout === "number" ? rawInput.smtp_timeout : undefined,
    yahoo_verif_method: rawInput.yahoo_verif_method || null,
    hotmailb2c_verif_method: rawInput.hotmailb2c_verif_method || null,
  };

  const skippedVerifMethod = { type: "skipped" };

  const syntax = checkSyntax(input.to_email);
  emit("syntax", syntax);
  if (!syntax.is_valid_syntax) {
    return buildResult({
      input: input.to_email,
      isReachable: "invalid",
      syntax,
      misc: null,
      mx: { accepts_mail: false, records: [], preferred: null, lookupError: null },
      smtpValue: buildDefaultSmtpDetails(),
      smtpError: null,
      debug: {
        backendName: input.backend_name,
        startTime,
        endTime: new Date(),
        startTimeMs,
        verifMethod: skippedVerifMethod,
      },
    });
  }

  const misc = await checkMisc(syntax, input);

  let mxResult;
  try {
    mxResult = await checkMx(syntax.domain);
    emit("mx", {
      accepts_mail: mxResult.accepts_mail,
      records: mxResult.records,
      preferred: mxResult.preferred,
      lookupError: mxResult.lookupError || null,
    });
  } catch (err) {
    getSimilarMailProvider(syntax);
    const lookupError = {
      type: err?.code || err?.name || "MxError",
      message: err?.message || String(err),
    };
    emit("mx", {
      accepts_mail: false,
      records: [],
      preferred: null,
      lookupError,
    });
    return buildResult({
      input: input.to_email,
      isReachable: "unknown",
      syntax,
      misc,
      mx: {
        accepts_mail: false,
        records: [],
        preferred: null,
        lookupError,
      },
      smtpValue: buildDefaultSmtpDetails(),
      smtpError: null,
      debug: {
        backendName: input.backend_name,
        startTime,
        endTime: new Date(),
        startTimeMs,
        verifMethod: skippedVerifMethod,
      },
    });
  }

  if (!mxResult.accepts_mail || !mxResult.preferred) {
    getSimilarMailProvider(syntax);
    return buildResult({
      input: input.to_email,
      isReachable: "invalid",
      syntax,
      misc,
      mx: {
        accepts_mail: false,
        records: mxResult.records,
        preferred: null,
        lookupError: mxResult.lookupError || null,
      },
      smtpValue: buildDefaultSmtpDetails(),
      smtpError: null,
      debug: {
        backendName: input.backend_name,
        startTime,
        endTime: new Date(),
        startTimeMs,
        verifMethod: skippedVerifMethod,
      },
    });
  }

  const mxHost = mxResult.preferred.exchange;
  const hasTimeoutRule = hasRule(syntax.domain, mxHost, Rule.SMTP_TIMEOUT_45S);

  const mxProvider = providerFromMx(mxHost);
  // When MX classifier finds nothing, fall back to a domain-based lookup
  // (rules.json `providers.by_domain`) so freemail providers without a unique
  // MX suffix still get classified.
  const provider =
    mxProvider === "everything_else"
      ? providerFromDomain(syntax.domain) || mxProvider
      : mxProvider;
  const chosenMethod = chosenMethodForProvider(provider, input);

  const smtpResult = await checkSmtp({
    toEmail: syntax.address,
    mxHost,
    domain: syntax.domain,
    smtpPort: input.smtp_port,
    smtpTimeoutMs: resolveSmtpTimeoutMs(input, hasTimeoutRule),
    proxy: input.proxy,
    helloName: input.hello_name,
    fromEmail: input.from_email,
    retries: input.retries,
    provider,
    chosenMethod,
    allowGreylistRetry,
    greylistRetryMs,
    onProgress,
  });

  if (smtpResult.smtpError) {
    getSimilarMailProvider(syntax);
  }

  const verifMethod = {
    ...(smtpResult.debug?.verif_method || skippedVerifMethod),
  };

  if (chosenMethod !== "smtp") {
    verifMethod.requested_method = chosenMethod;
    verifMethod.fallback_to = "smtp";
  }

  return buildResult({
    input: input.to_email,
    isReachable: calculateReachable(misc, smtpResult.smtp, smtpResult.smtpError),
    syntax,
    misc,
    mx: {
      accepts_mail: mxResult.accepts_mail,
      records: mxResult.records,
      preferred: mxResult.preferred,
      lookupError: mxResult.lookupError || null,
    },
    smtpValue: smtpResult.smtp,
    smtpError: smtpResult.smtpError,
    debug: {
      backendName: input.backend_name,
      startTime,
      endTime: new Date(),
      startTimeMs,
      verifMethod,
    },
  });
}

module.exports = {
  calculateReachable,
  calculateRiskScore,
  checkEmail,
};
