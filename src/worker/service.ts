// @ts-nocheck
const crypto = require("node:crypto");
const { checkEmail } = require("../checker/checkEmail");

const WEBHOOK_BACKOFF_MS = [1000, 5000, 30000];
const WEBHOOK_MAX_ATTEMPTS = 4;
const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";

function canonicalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function dedupeEmails(inputs) {
  const originalInputs = [];
  const uniqueEmails = [];
  const seen = new Set();

  if (!Array.isArray(inputs)) {
    return { uniqueEmails, originalInputs };
  }

  for (const raw of inputs) {
    if (raw === undefined || raw === null) continue;
    const original = String(raw);
    const canonical = canonicalizeEmail(original);
    if (!canonical) continue;

    originalInputs.push(original);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      uniqueEmails.push(canonical);
    }
  }

  return { uniqueEmails, originalInputs };
}

function taskError(message, statusCode = 500) {
  return {
    message: String(message),
    status_code: statusCode,
  };
}

function signPayload(secret, body) {
  if (!secret) {
    return "";
  }
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function deliverWebhook(task, result, config, options = {}) {
  const webhook = task?.webhook?.on_each_email;
  if (!webhook?.url) {
    return;
  }

  const fetchImpl = options.fetch || globalThis.fetch;
  const sleepImpl = options.sleep || sleep;
  const logger = options.logger || console;
  const backoff = options.backoffMs || WEBHOOK_BACKOFF_MS;
  const maxAttempts = options.maxAttempts || WEBHOOK_MAX_ATTEMPTS;
  const secret = config?.worker?.webhook?.secret || null;

  if (!task.__webhookTaskId) {
    task.__webhookTaskId = task.input?.task_id || crypto.randomUUID();
  }
  const taskId = task.__webhookTaskId;
  const jobId = task.job_id ?? null;
  const email = task.input?.to_email ?? null;

  const body = JSON.stringify({
    result,
    extra: webhook.extra ?? null,
    taskId,
    email,
    jobId,
  });

  const userHeaders = webhook.headers || {};
  const headers = {
    "content-type": "application/json",
    ...userHeaders,
  };
  if (secret) {
    headers[WEBHOOK_SIGNATURE_HEADER] = signPayload(secret, body);
  }

  let lastError = null;
  let lastStatus = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      const delay = backoff[attempt - 2] ?? backoff[backoff.length - 1];
      await sleepImpl(delay);
    }

    try {
      const res = await fetchImpl(webhook.url, {
        method: "POST",
        headers,
        body,
      });

      if (res.status >= 200 && res.status < 300) {
        return;
      }

      lastStatus = res.status;
      lastError = `HTTP ${res.status}`;

      if (!isRetriableStatus(res.status)) {
        break;
      }
    } catch (err) {
      lastError = err?.message || String(err);
      lastStatus = null;
    }
  }

  const logLine = JSON.stringify({
    level: "error",
    event: "webhook_delivery_failed",
    endpoint: webhook.url,
    taskId,
    jobId,
    email,
    attempts: maxAttempts,
    status: lastStatus,
    error: lastError,
  });
  // eslint-disable-next-line no-console
  logger.log(logLine);
}

async function sendCommercialTrial(config, email, workerOutput) {
  const trial = config.commercial_license_trial;
  if (!trial?.url || !trial?.api_token) {
    return;
  }

  await fetch(trial.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: trial.api_token,
    },
    body: JSON.stringify(workerOutput),
  });
}

async function processCheckEmailTask(task, config) {
  try {
    const result = await checkEmail(task.input, {
      allowGreylistRetry: true,
      greylistRetryMs: config?.smtp?.greylist_retry_ms,
    });
    try {
      await deliverWebhook(task, result, config);
    } catch (_) {
      // webhook failures must never break the worker ack flow
    }

    const workerOutput = {
      ok: true,
      result,
    };

    await sendCommercialTrial(config, task.input.to_email, workerOutput);

    return workerOutput;
  } catch (err) {
    const workerOutput = {
      ok: false,
      error: taskError(err?.message || String(err)),
    };

    await sendCommercialTrial(config, task.input?.to_email, workerOutput);

    return workerOutput;
  }
}

module.exports = {
  canonicalizeEmail,
  dedupeEmails,
  processCheckEmailTask,
  taskError,
  deliverWebhook,
  signPayload,
};
