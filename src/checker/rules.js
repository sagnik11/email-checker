const { rules } = require("./data");

const Rule = {
  SKIP_CATCH_ALL: "SkipCatchAll",
  SMTP_TIMEOUT_45S: "SmtpTimeout45s",
};

function hasRuleByDomain(domain, rule) {
  return Boolean(rules.by_domain?.[domain]?.rules?.includes(rule));
}

function hasRuleByMx(host, rule) {
  return Boolean(rules.by_mx?.[host]?.rules?.includes(rule));
}

function hasRuleByMxSuffix(host, rule) {
  const suffixMap = rules.by_mx_suffix || {};
  for (const [suffix, value] of Object.entries(suffixMap)) {
    if (host.endsWith(suffix) && value?.rules?.includes(rule)) {
      return true;
    }
  }
  return false;
}

function normalizeMxHost(host) {
  const h = String(host || "").toLowerCase();
  return h.endsWith(".") ? h : `${h}.`;
}

function hasRule(domain, mxHost, rule) {
  const d = String(domain || "").toLowerCase();
  const h = normalizeMxHost(mxHost);
  return hasRuleByDomain(d, rule) || hasRuleByMx(h, rule) || hasRuleByMxSuffix(h, rule);
}

module.exports = {
  Rule,
  hasRule,
  normalizeMxHost,
};
