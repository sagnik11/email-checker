// @ts-nocheck
const pino = require("pino");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "email-validation-service" },
});

module.exports = { logger };
