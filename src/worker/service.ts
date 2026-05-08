// @ts-nocheck
const { checkEmail } = require("../checker/checkEmail");

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

async function sendWebhook(task, output) {
  const webhook = task?.webhook?.on_each_email;
  if (!webhook?.url) {
    return;
  }

  const headers = webhook.headers || {};
  await fetch(webhook.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      result: output,
      extra: webhook.extra ?? null,
    }),
  });
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
    const result = await checkEmail(task.input);
    await sendWebhook(task, result);

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
};
