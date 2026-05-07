// @ts-nocheck
const dns = require("node:dns/promises");
const { normalizeMxHost } = require("./rules");

function getMxErrorType(err) {
  if (!err) return "UnknownError";
  if (typeof err.code === "string") return err.code;
  return err.name || "Error";
}

async function checkMx(domain) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", source: "mx", msg: "resolving MX", domain }));
  try {
    const mxRecords = await dns.resolveMx(domain);
    const sorted = mxRecords
      .map((x) => ({ exchange: normalizeMxHost(x.exchange), priority: x.priority }))
      .sort((a, b) => a.priority - b.priority);

    const result = {
      accepts_mail: sorted.length > 0,
      records: sorted.map((x) => x.exchange),
      preferred: sorted[0] || null,
      lookupError: null,
    };
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", source: "mx", msg: "MX resolved", domain, records: result.records }));
    return result;
  } catch (err) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", source: "mx", msg: "MX lookup failed", domain, code: err?.code, error: err?.message }));
    if (["ENODATA", "ENOTFOUND", "NXDOMAIN", "SERVFAIL"].includes(err?.code)) {
      return {
        accepts_mail: false,
        records: [],
        preferred: null,
        lookupError: {
          type: getMxErrorType(err),
          message: err.message || "No MX records",
        },
      };
    }

    throw err;
  }
}

module.exports = {
  checkMx,
};
