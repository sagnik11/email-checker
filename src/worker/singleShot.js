function serializeSingleShotReply(workerOutput) {
  if (workerOutput.ok) {
    return {
      kind: "ok",
      body: Buffer.from(JSON.stringify(workerOutput.result)).toString("base64"),
    };
  }

  return {
    kind: "err",
    error: workerOutput.error?.message || "Worker error",
    code: workerOutput.error?.status_code || 500,
  };
}

async function sendSingleShotReply(channel, msg, workerOutput) {
  const replyTo = msg.properties.replyTo;
  const correlationId = msg.properties.correlationId;

  if (!replyTo || !correlationId) {
    return;
  }

  const payload = Buffer.from(JSON.stringify(serializeSingleShotReply(workerOutput)));
  channel.sendToQueue(replyTo, payload, {
    contentType: "application/json",
    correlationId,
  });
}

module.exports = {
  sendSingleShotReply,
};
