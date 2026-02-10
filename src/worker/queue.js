const amqp = require("amqplib");

const CHECK_EMAIL_QUEUE = "check_email";
const MAX_QUEUE_PRIORITY = 5;

async function setupRabbitMQ(config) {
  const url = config.worker?.rabbitmq?.url;
  if (!url) {
    throw new Error("RabbitMQ URL is missing in config.worker.rabbitmq.url");
  }

  const conn = await amqp.connect(url);
  const channel = await conn.createChannel();

  await channel.assertQueue(CHECK_EMAIL_QUEUE, {
    durable: true,
    maxPriority: MAX_QUEUE_PRIORITY,
  });

  const concurrency = Number(config.worker?.rabbitmq?.concurrency || 5);
  await channel.prefetch(concurrency, false);

  return { conn, channel };
}

async function publishTask(channel, task, options = {}) {
  const payload = Buffer.from(JSON.stringify(task));
  const ok = channel.sendToQueue(CHECK_EMAIL_QUEUE, payload, {
    contentType: "application/json",
    persistent: true,
    priority: options.priority,
    correlationId: options.correlationId,
    replyTo: options.replyTo,
  });

  if (!ok) {
    await new Promise((resolve) => channel.once("drain", resolve));
  }
}

module.exports = {
  CHECK_EMAIL_QUEUE,
  MAX_QUEUE_PRIORITY,
  publishTask,
  setupRabbitMQ,
};
