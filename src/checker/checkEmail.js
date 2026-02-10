const { checkSyntax, getSimilarMailProvider } = require("./syntax");
const { checkMx } = require("./mx");
const { checkMisc } = require("./misc");
const { Rule, hasRule } = require("./rules");
const { buildDefaultSmtpDetails, checkSmtp } = require("./smtp");
const { providerFromMx } = require("./provider");
const { durationFromMs } = require("./util");

function defaultMisc() {
  return {
    is_disposable: false,
    is_role_account: false,
    is_b2c: false,
    gravatar_url: null,
    haveibeenpwned: null,
  };
}

function defaultMx() {
  return {
    accepts_mail: false,
    records: [],
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

async function checkEmail(rawInput = {}) {
  const startTimeMs = Date.now();
  const startTime = new Date(startTimeMs);

  const input = {
    to_email: String(rawInput.to_email || "").trim(),
    from_email:
      rawInput.from_email || process.env.WQ_FROM_EMAIL || "noreply@worqhat.com",
    hello_name:
      rawInput.hello_name || process.env.WQ_HELLO_NAME || "worqhat.com",
    smtp_port: Number(rawInput.smtp_port || 25),
    retries: Number(rawInput.retries || 1),
    proxy: rawInput.proxy || null,
    check_gravatar: Boolean(rawInput.check_gravatar),
    haveibeenpwned_api_key:
      rawInput.haveibeenpwned_api_key || process.env.WQ_HIBP_API_KEY || null,
    backend_name: rawInput.backend_name || process.env.WQ_BACKEND_NAME || "backend-dev",
    smtp_timeout_ms:
      typeof rawInput.smtp_timeout_ms === "number"
        ? rawInput.smtp_timeout_ms
        : undefined,
    smtp_timeout:
      typeof rawInput.smtp_timeout === "number" ? rawInput.smtp_timeout : undefined,
    yahoo_verif_method: rawInput.yahoo_verif_method || null,
    hotmailb2c_verif_method: rawInput.hotmailb2c_verif_method || null,
  };

  const syntax = checkSyntax(input.to_email);
  if (!syntax.is_valid_syntax) {
    const endTime = new Date();
    return {
      input: input.to_email,
      is_reachable: "invalid",
      misc: defaultMisc(),
      mx: defaultMx(),
      smtp: buildDefaultSmtpDetails(),
      syntax,
      debug: {
        backend_name: input.backend_name,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration: durationFromMs(endTime.getTime() - startTimeMs),
        smtp: {
          verif_method: {
            type: "skipped",
          },
        },
      },
    };
  }

  const misc = await checkMisc(syntax, input);

  let mxResult;
  try {
    mxResult = await checkMx(syntax.domain);
  } catch (err) {
    getSimilarMailProvider(syntax);
    const endTime = new Date();
    return {
      input: input.to_email,
      is_reachable: "unknown",
      misc,
      mx: {
        error: {
          type: err?.code || err?.name || "MxError",
          message: err?.message || String(err),
        },
      },
      smtp: buildDefaultSmtpDetails(),
      syntax,
      debug: {
        backend_name: input.backend_name,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration: durationFromMs(endTime.getTime() - startTimeMs),
        smtp: {
          verif_method: {
            type: "skipped",
          },
        },
      },
    };
  }

  if (!mxResult.accepts_mail || !mxResult.preferred) {
    getSimilarMailProvider(syntax);
    const endTime = new Date();
    return {
      input: input.to_email,
      is_reachable: "invalid",
      misc,
      mx: {
        accepts_mail: false,
        records: mxResult.records,
      },
      smtp: buildDefaultSmtpDetails(),
      syntax,
      debug: {
        backend_name: input.backend_name,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration: durationFromMs(endTime.getTime() - startTimeMs),
        smtp: {
          verif_method: {
            type: "skipped",
          },
        },
      },
    };
  }

  const mxHost = mxResult.preferred.exchange;
  const hasTimeoutRule = hasRule(syntax.domain, mxHost, Rule.SMTP_TIMEOUT_45S);

  const provider = providerFromMx(mxHost);
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
  });

  if (smtpResult.smtpError) {
    getSimilarMailProvider(syntax);
  }

  const endTime = new Date();
  const debugSmtp = smtpResult.debug || {
    verif_method: {
      type: "skipped",
    },
  };

  if (chosenMethod !== "smtp") {
    debugSmtp.verif_method = {
      ...debugSmtp.verif_method,
      requested_method: chosenMethod,
      fallback_to: "smtp",
    };
  }

  return {
    input: input.to_email,
    is_reachable: calculateReachable(misc, smtpResult.smtp, smtpResult.smtpError),
    misc,
    mx: {
      accepts_mail: mxResult.accepts_mail,
      records: mxResult.records,
    },
    smtp: smtpResult.smtpError || smtpResult.smtp,
    syntax,
    debug: {
      backend_name: input.backend_name,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      duration: durationFromMs(endTime.getTime() - startTimeMs),
      smtp: debugSmtp,
    },
  };
}

module.exports = {
  checkEmail,
};
