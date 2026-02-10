function pickSmtpConfigFromConfig(config) {
  return {
    hello_name: config.hello_name,
    from_email: config.from_email,
    smtp_timeout: config.smtp_timeout,
    smtp_port: 25,
    retries: 1,
    proxy: config.proxy || null,
  };
}

function parseBackwardCompatMethod(value, allowed) {
  if (!value) return null;
  const raw = String(value).toLowerCase();
  if (allowed.includes(raw)) return raw;
  return null;
}

function mapRequestToCheckInput(body, config, opts = {}) {
  const request = body || {};
  const smtpFromConfig = pickSmtpConfigFromConfig(config);

  // Keep Rust behavior: if proxy is unset, body-level SMTP fields are ignored.
  let smtpConfig;
  if (request.proxy) {
    smtpConfig = {
      hello_name: request.hello_name || smtpFromConfig.hello_name,
      from_email: request.from_email || smtpFromConfig.from_email,
      smtp_timeout:
        request.smtp_timeout !== undefined
          ? request.smtp_timeout
          : smtpFromConfig.smtp_timeout,
      smtp_port: request.smtp_port || 25,
      retries: 1,
      proxy: request.proxy,
    };
  } else {
    smtpConfig = smtpFromConfig;
  }

  return {
    to_email: String(request.to_email || ""),
    hello_name: smtpConfig.hello_name,
    from_email: smtpConfig.from_email,
    smtp_timeout: smtpConfig.smtp_timeout,
    smtp_port: smtpConfig.smtp_port,
    retries: smtpConfig.retries,
    proxy: smtpConfig.proxy,
    backend_name: config.backend_name,
    check_gravatar: Boolean(request.check_gravatar),
    haveibeenpwned_api_key:
      request.haveibeenpwned_api_key || process.env.WQ_HIBP_API_KEY || null,
    yahoo_verif_method:
      parseBackwardCompatMethod(request.yahoo_verif_method, ["api", "headless", "smtp"]) ||
      null,
    hotmailb2c_verif_method:
      parseBackwardCompatMethod(request.hotmailb2c_verif_method, ["headless", "smtp"]) ||
      null,
    job_source: opts.job_source || "single",
  };
}

module.exports = {
  mapRequestToCheckInput,
};
