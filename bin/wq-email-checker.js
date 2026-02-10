#!/usr/bin/env node

const { Command } = require("commander");
const { checkEmail, startServer, startWorker } = require("../src/index");

const program = new Command();
program
  .name("wq-email-checker")
  .description("WorqHat Email Checker Node backend and CLI")
  .version("0.2.0");

program
  .command("serve")
  .description("Run HTTP server")
  .option("--config <path>", "Path to backend_config.toml")
  .option("--host <host>", "Bind host")
  .option("--port <port>", "Bind port")
  .option("--no-inline-worker", "Disable worker in API process")
  .action(async (opts) => {
    const out = await startServer({
      configPath: opts.config,
      host: opts.host,
      port: opts.port ? Number(opts.port) : undefined,
      runWorkerInline: opts.inlineWorker,
    });

    // eslint-disable-next-line no-console
    console.log(
      `listening on http://${out.runtime.config.http_host}:${out.runtime.config.http_port}`
    );
  });

program
  .command("worker")
  .description("Run worker only")
  .option("--config <path>", "Path to backend_config.toml")
  .action(async (opts) => {
    await startWorker({
      config: require("../src/config").loadConfig({ configPath: opts.config }),
    });

    // eslint-disable-next-line no-console
    console.log("worker started");
  });

program
  .command("check")
  .description("Check one email directly")
  .argument("<email>", "Target email")
  .option("--from-email <email>", "MAIL FROM address")
  .option("--hello-name <name>", "EHLO name")
  .option("--smtp-port <port>", "SMTP port", "25")
  .option("--smtp-timeout-ms <ms>", "SMTP timeout in milliseconds")
  .option("--retries <n>", "Retry count", "1")
  .option("--check-gravatar", "Check gravatar")
  .option("--hibp-api-key <key>", "HaveIBeenPwned API key")
  .option("--proxy-host <host>", "SOCKS5 proxy host")
  .option("--proxy-port <port>", "SOCKS5 proxy port")
  .option("--proxy-username <username>", "SOCKS5 proxy username")
  .option("--proxy-password <password>", "SOCKS5 proxy password")
  .option("--proxy-timeout-ms <ms>", "SOCKS5 connect timeout in ms")
  .action(async (email, opts) => {
    const body = {
      to_email: email,
      from_email: opts.fromEmail,
      hello_name: opts.helloName,
      smtp_port: Number(opts.smtpPort),
      smtp_timeout_ms:
        opts.smtpTimeoutMs !== undefined ? Number(opts.smtpTimeoutMs) : undefined,
      retries: Number(opts.retries),
      check_gravatar: Boolean(opts.checkGravatar),
      haveibeenpwned_api_key: opts.hibpApiKey,
    };

    if (opts.proxyHost && opts.proxyPort) {
      body.proxy = {
        host: opts.proxyHost,
        port: Number(opts.proxyPort),
        username: opts.proxyUsername,
        password: opts.proxyPassword,
        timeout_ms:
          opts.proxyTimeoutMs !== undefined ? Number(opts.proxyTimeoutMs) : undefined,
      };
    }

    const result = await checkEmail(body);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.is_reachable === "unknown" ? 2 : 0;
  });

program.parse(process.argv);

if (process.argv.length <= 2) {
  program.outputHelp();
}
