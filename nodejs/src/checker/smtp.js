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

function toSmtpError(type, message, description) {
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
    return tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });
  }

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

  const cleanHost = String(mxHost || "").replace(/\.$/, "");
  const socket = await connectSocket(cleanHost, smtpPort, smtpTimeoutMs, proxy);
  socket.setTimeout(smtpTimeoutMs, () => {
    socket.destroy(new Error("SMTP timeout"));
  });

  const reader = createLineReader(socket);

  try {
    const greeting = await readResponse(reader, smtpTimeoutMs);
    if (greeting.code !== 220) {
      throw new Error(`Unexpected SMTP greeting: ${greeting.message}`);
    }

    const ehlo = await sendCommand(socket, reader, `EHLO ${helloName}`, smtpTimeoutMs);
    if (!(ehlo.code >= 200 && ehlo.code < 300)) {
      throw new Error(`EHLO failed: ${ehlo.message}`);
    }

    const mailFrom = await sendCommand(
      socket,
      reader,
      `MAIL FROM:<${fromEmail}>`,
      smtpTimeoutMs
    );
    if (!(mailFrom.code >= 200 && mailFrom.code < 300)) {
      throw new Error(`MAIL FROM failed: ${mailFrom.message}`);
    }

    let isCatchAll = false;
    const shouldSkipCatchAll = hasRule(domain, mxHost, Rule.SKIP_CATCH_ALL);

    if (!shouldSkipCatchAll) {
      const randomEmail = `${crypto.randomBytes(8).toString("hex")}@${domain}`;
      const randomRcpt = await sendCommand(
        socket,
        reader,
        `RCPT TO:<${randomEmail}>`,
        smtpTimeoutMs
      );
      isCatchAll = randomRcpt.code === 250 || randomRcpt.code === 251;
    }

    let deliverability;
    if (isCatchAll) {
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

      if (rcpt.code === 250 || rcpt.code === 251) {
        deliverability = {
          has_full_inbox: false,
          is_deliverable: true,
          is_disabled: false,
        };
      } else {
        const parsed = classifySmtpErrorMessage(rcpt.message, toEmail);
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

  let lastResult = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const result = await checkSmtpOnce(config);
      if (!result.smtpError) {
        return result;
      }

      lastResult = result;
      if (result.smtpError.description || attempt === retries) {
        return result;
      }
    } catch (err) {
      const message = err?.message || String(err);
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
