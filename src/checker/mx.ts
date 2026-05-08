// @ts-nocheck
const dns = require("node:dns/promises");
const { normalizeMxHost } = require("./rules");
const { logger } = require("../logger");

const mxLogger = logger.child({ source: "mx" });

function getMxErrorType(err) {
  if (!err) return "UnknownError";
  if (typeof err.code === "string") return err.code;
  return err.name || "Error";
}

async function checkMx(domain) {
  mxLogger.info({ domain }, "resolving MX");
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
    mxLogger.info({ domain, records: result.records }, "MX resolved");
    return result;
  } catch (err) {
    mxLogger.error(
      { domain, code: err?.code, error: err?.message },
      "MX lookup failed"
    );
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
