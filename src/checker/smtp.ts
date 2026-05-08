// @ts-nocheck
const net = require("node:net");
const tls = require("node:tls");
const crypto = require("node:crypto");
const { SocksClient } = require("socks");
const { Rule, hasRule, normalizeMxHost } = require("./rules");
const {
  isDisabledAccountError,
  isFullInboxError,
  isInvalidError,
  isIpBlacklistedError,
  isNeedsRdnsError,
} = require("./smtpParser");
const { logger } = require("../logger");
const { recordSmtpError } = require("../http/metrics");

const SMTP_LOG = process.env.SMTP_DEBUG === "true";
const smtpLogger = logger.child({ source: "smtp" });

function smtpLog(level, msg, meta = {}) {
  if (level === "error") {
    smtpLogger.error(meta, msg);
  } else if (level === "warn") {
    smtpLogger.warn(meta, msg);
  } else if (level === "debug") {
    smtpLogger.debug(meta, msg);
  } else {
    smtpLogger.info(meta, msg);
  }
}

function toSmtpError(type, message, description) {
  recordSmtpError(message);
  return {
    error: {
      type,
      message,
    },
    ...(description ? { description } : {}),
  };
}

function buildDefaultSmtpDetails() {
  return {
    can_connect_smtp: false,
    has_full_inbox: false,
    is_catch_all: false,
    is_deliverable: false,
    is_disabled: false,
  };
}

function createLineReader(socket) {
  let buffer = "";
  let ended = false;
  const queue = [];
  const waiters = [];

  function pushLine(line) {
    if (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter.resolve(line);
    } else {
      queue.push(line);
    }
  }

  function failAll(err) {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter.reject(err);
    }
  }

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      pushLine(line);
      idx = buffer.indexOf("\n");
    }
  });

  socket.on("end", () => {
    ended = true;
    failAll(new Error("SMTP socket ended"));
  });

  socket.on("error", (err) => {
    ended = true;
    failAll(err);
  });

  async function readLine(timeoutMs) {
    if (queue.length > 0) {
      return queue.shift();
    }

    if (ended) {
      throw new Error("SMTP socket closed");
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) {
          waiters.splice(idx, 1);
        }
        reject(new Error("SMTP read timeout"));
      }, timeoutMs);

      waiters.push({
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  return { readLine };
}

async function readResponse(reader, timeoutMs) {
  const firstLine = await reader.readLine(timeoutMs);
  if (!/^\d{3}[\s-]/.test(firstLine)) {
    return {
      code: 0,
      lines: [firstLine],
      message: firstLine,
      success: false,
    };
  }

  const code = Number(firstLine.slice(0, 3));
  const lines = [firstLine.slice(4).trim()];
  let separator = firstLine[3];

  while (separator === "-") {
    const line = await reader.readLine(timeoutMs);
    if (/^\d{3}[\s-]/.test(line)) {
      separator = line[3];
      lines.push(line.slice(4).trim());
      if (Number(line.slice(0, 3)) !== code) {
        break;
      }
    } else {
      separator = " ";
      lines.push(line.trim());
    }
  }

  return {
    code,
    lines,
    message: lines.join("; "),
    success: code >= 200 && code < 400,
  };
}

async function connectSocket(host, port, timeoutMs, proxy) {
  smtpLog("info", "connecting", { host, port, timeout_ms: timeoutMs, via_proxy: Boolean(proxy?.host) });

  if (proxy && proxy.host && proxy.port) {
    const connection = await SocksClient.createConnection({
      command: "connect",
      destination: { host, port },
      proxy: {
        host: proxy.host,
        port: Number(proxy.port),
        type: 5,
        userId: proxy.username,
        password: proxy.password,
      },
      timeout: proxy.timeout_ms || timeoutMs,
    });

    smtpLog("info", "proxy tunnel established", { host, port });

    if (port === 465) {
      return tls.connect({
        socket: connection.socket,
        servername: host,
        rejectUnauthorized: false,
      });
    }

    return connection.socket;
  }

  if (port === 465) {
    smtpLog("info", "using TLS socket (port 465)", { host });
    return tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });
  }

  smtpLog("info", "using plain TCP socket", { host, port });
  return net.createConnection({ host, port, timeout: timeoutMs });
}

function classifySmtpErrorMessage(message, toEmail) {
  const lower = String(message || "").toLowerCase();

  if (isDisabledAccountError(lower)) {
    return {
      deliverability: {
        has_full_inbox: false,
        is_deliverable: false,
        is_disabled: true,
      },
    };
  }

  if (isFullInboxError(lower)) {
    return {
      deliverability: {
        has_full_inbox: true,
        is_deliverable: false,
        is_disabled: false,
      },
    };
  }

  if (
    lower.includes(
      "the user you are trying to contact is receiving mail at a rate that"
    )
  ) {
    return {
      deliverability: {
        has_full_inbox: false,
        is_deliverable: true,
        is_disabled: false,
      },
    };
  }

  if (isInvalidError(lower, toEmail)) {
    return {
      deliverability: {
        has_full_inbox: false,
        is_deliverable: false,
        is_disabled: false,
      },
    };
  }

  if (isIpBlacklistedError(lower)) {
    return {
      error: toSmtpError("SmtpError", message, "IpBlacklisted"),
    };
  }

  if (isNeedsRdnsError(lower)) {
    return {
      error: toSmtpError("SmtpError", message, "NeedsRDNS"),
    };
  }

  return {
    error: toSmtpError("SmtpError", message),
  };
}

async function sendCommand(socket, reader, cmd, timeoutMs) {
  await new Promise((resolve, reject) => {
    socket.write(`${cmd}\r\n`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  return readResponse(reader, timeoutMs);
}

async function checkSmtpOnce(input) {
  const {
    toEmail,
    mxHost,
    domain,
    smtpPort,
    smtpTimeoutMs,
    proxy,
    helloName,
    fromEmail,
    provider,
    chosenMethod,
  } = input;

  smtpLog("info", "smtp check start", {
    to_email: toEmail,
    mx_host: mxHost,
    domain,
    smtp_port: smtpPort,
    timeout_ms: smtpTimeoutMs,
    hello_name: helloName,
    from_email: fromEmail,
    provider,
    chosen_method: chosenMethod,
  });

  const cleanHost = String(mxHost || "").replace(/\.$/, "");
  const socket = await connectSocket(cleanHost, smtpPort, smtpTimeoutMs, proxy);
  socket.setTimeout(smtpTimeoutMs, () => {
    socket.destroy(new Error("SMTP timeout"));
  });

  const reader = createLineReader(socket);

  try {
    smtpLog("info", "waiting for SMTP greeting", { mx_host: cleanHost, smtp_port: smtpPort });
    const greeting = await readResponse(reader, smtpTimeoutMs);
    smtpLog("info", "SMTP greeting received", { code: greeting.code, message: greeting.message });

    if (greeting.code !== 220) {
      smtpLog("error", "unexpected SMTP greeting", { code: greeting.code, message: greeting.message });
      throw new Error(`Unexpected SMTP greeting: ${greeting.message}`);
    }

    const ehlo = await sendCommand(socket, reader, `EHLO ${helloName}`, smtpTimeoutMs);
    smtpLog("info", "EHLO response", { code: ehlo.code, message: ehlo.message });
    if (!(ehlo.code >= 200 && ehlo.code < 300)) {
      smtpLog("error", "EHLO failed", { code: ehlo.code, message: ehlo.message });
      throw new Error(`EHLO failed: ${ehlo.message}`);
    }

    const mailFrom = await sendCommand(
      socket,
      reader,
      `MAIL FROM:<${fromEmail}>`,
      smtpTimeoutMs
    );
    smtpLog("info", "MAIL FROM response", { code: mailFrom.code, message: mailFrom.message });
    if (!(mailFrom.code >= 200 && mailFrom.code < 300)) {
      smtpLog("error", "MAIL FROM failed", { code: mailFrom.code, message: mailFrom.message });
      throw new Error(`MAIL FROM failed: ${mailFrom.message}`);
    }

    let isCatchAll = false;
    const shouldSkipCatchAll = hasRule(domain, mxHost, Rule.SKIP_CATCH_ALL);

    if (!shouldSkipCatchAll) {
      const randomEmail = `${crypto.randomBytes(8).toString("hex")}@${domain}`;
      smtpLog("info", "catch-all probe", { random_email: randomEmail });
      const randomRcpt = await sendCommand(
        socket,
        reader,
        `RCPT TO:<${randomEmail}>`,
        smtpTimeoutMs
      );
      isCatchAll = randomRcpt.code === 250 || randomRcpt.code === 251;
      smtpLog("info", "catch-all probe result", { code: randomRcpt.code, is_catch_all: isCatchAll });
    } else {
      smtpLog("info", "catch-all probe skipped (rule)", { domain, mx_host: mxHost });
    }

    let deliverability;
    if (isCatchAll) {
      smtpLog("info", "catch-all domain, marking deliverable", { domain });
      deliverability = {
        has_full_inbox: false,
        is_deliverable: true,
        is_disabled: false,
      };
    } else {
      const rcpt = await sendCommand(
        socket,
        reader,
        `RCPT TO:<${toEmail}>`,
        smtpTimeoutMs
      );
      smtpLog("info", "RCPT TO response", { to_email: toEmail, code: rcpt.code, message: rcpt.message });

      if (rcpt.code === 250 || rcpt.code === 251) {
        deliverability = {
          has_full_inbox: false,
          is_deliverable: true,
          is_disabled: false,
        };
      } else {
        const parsed = classifySmtpErrorMessage(rcpt.message, toEmail);
        smtpLog("info", "RCPT classified", { parsed });
        if (parsed.error) {
          return {
            smtp: buildDefaultSmtpDetails(),
            smtpError: parsed.error,
            debug: {
              verif_method: {
                type: "smtp",
                host: normalizeMxHost(mxHost),
                smtp_port: smtpPort,
                provider,
                method: chosenMethod || "smtp",
              },
            },
          };
        }
        deliverability = parsed.deliverability;
      }
    }

    try {
      await sendCommand(socket, reader, "QUIT", smtpTimeoutMs);
    } catch (_) {
      // Ignore QUIT errors.
    }

    smtpLog("info", "smtp check complete", { to_email: toEmail, deliverability, is_catch_all: isCatchAll });

    return {
      smtp: {
        can_connect_smtp: true,
        has_full_inbox: deliverability.has_full_inbox,
        is_catch_all: isCatchAll,
        is_deliverable: deliverability.is_deliverable,
        is_disabled: deliverability.is_disabled,
      },
      smtpError: null,
      debug: {
        verif_method: {
          type: "smtp",
          host: normalizeMxHost(mxHost),
          smtp_port: smtpPort,
          provider,
          method: chosenMethod || "smtp",
        },
      },
    };
  } finally {
    if (!socket.destroyed) {
      socket.destroy();
    }
  }
}

async function checkSmtp(config) {
  const retries = Math.max(1, Number(config.retries || 1));

  smtpLog("info", "checkSmtp entry", {
    to_email: config.toEmail,
    mx_host: config.mxHost,
    smtp_port: config.smtpPort,
    retries,
  });

  let lastResult = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      smtpLog("info", `attempt ${attempt}/${retries}`, { mx_host: config.mxHost, smtp_port: config.smtpPort });
      const result = await checkSmtpOnce(config);
      if (!result.smtpError) {
        smtpLog("info", `attempt ${attempt} succeeded`, { to_email: config.toEmail });
        return result;
      }

      smtpLog("info", `attempt ${attempt} smtp error`, { error: result.smtpError });
      lastResult = result;
      if (result.smtpError.description || attempt === retries) {
        return result;
      }
    } catch (err) {
      const message = err?.message || String(err);
      const errName = err?.name || err?.constructor?.name || "Error";
      const errCode = err?.code || (err?.errors && err.errors[0]?.code) || undefined;

      smtpLog("error", `attempt ${attempt} threw exception`, {
        error_name: errName,
        error_code: errCode,
        error_message: message,
        mx_host: config.mxHost,
        smtp_port: config.smtpPort,
        hint: errCode === "ECONNREFUSED"
          ? "Port is likely blocked by the hosting provider. Try SMTP_PORT=587 in your environment variables."
          : errCode === "ETIMEDOUT" || message.includes("timeout")
          ? "Connection timed out. Outbound SMTP may be firewalled. Try SMTP_PORT=587."
          : undefined,
      });

      const description = isIpBlacklistedError(message)
        ? "IpBlacklisted"
        : isNeedsRdnsError(message)
        ? "NeedsRDNS"
        : undefined;

      lastResult = {
        smtp: buildDefaultSmtpDetails(),
        smtpError: toSmtpError("ConnectionError", message, description),
        debug: {
          verif_method: {
            type: "smtp",
            host: normalizeMxHost(config.mxHost),
            smtp_port: config.smtpPort,
            provider: config.provider,
            method: config.chosenMethod || "smtp",
          },
        },
      };

      if (description || attempt === retries) {
        return lastResult;
      }
    }
  }

  return (
    lastResult || {
      smtp: buildDefaultSmtpDetails(),
      smtpError: toSmtpError("Unknown", "Unknown SMTP error"),
      debug: {
        verif_method: {
          type: "smtp",
          host: normalizeMxHost(config.mxHost),
          smtp_port: config.smtpPort,
          provider: config.provider,
          method: config.chosenMethod || "smtp",
        },
      },
    }
  );
}

module.exports = {
  buildDefaultSmtpDetails,
  checkSmtp,
};
