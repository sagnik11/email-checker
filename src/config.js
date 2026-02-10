const fs = require("node:fs");
const path = require("node:path");
const toml = require("toml");

function defaultConfig() {
  return {
    backend_name: "backend-dev",
    from_email: "noreply@worqhat.com",
    hello_name: "worqhat.com",
    smtp_timeout: null,
    proxy: null,
    overrides: {
      proxies: {},
    },
    webdriver_addr: "http://localhost:9515",
    webdriver: {},
    http_host: "127.0.0.1",
    http_port: 8080,
    header_secret: null,
    sentry_dsn: null,
    worker: {
      enable: false,
      rabbitmq: {
        url: "amqp://guest:guest@localhost:5672",
        concurrency: 5,
      },
      webhook: null,
    },
    storage: {
      type: "noop",
    },
    commercial_license_trial: null,
    throttle: {
      max_requests_per_second: null,
      max_requests_per_minute: null,
      max_requests_per_hour: null,
      max_requests_per_day: null,
    },
  };
}

function deepMerge(target, source) {
  if (!source || typeof source !== "object") {
    return target;
  }

  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }

  return target;
}

function parseEnvValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);

  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return raw;
    }
  }

  return raw;
}

function applyEnvOverrides(config, env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("WQ__")) {
      continue;
    }

    const pathParts = key
      .slice("WQ__".length)
      .split("__")
      .map((x) => x.toLowerCase());

    let cur = config;
    for (let i = 0; i < pathParts.length - 1; i += 1) {
      const part = pathParts[i];
      if (!cur[part] || typeof cur[part] !== "object") {
        cur[part] = {};
      }
      cur = cur[part];
    }

    cur[pathParts[pathParts.length - 1]] = parseEnvValue(value);
  }

  if (env.PORT) {
    const parsedPort = Number(env.PORT);
    if (Number.isFinite(parsedPort)) {
      config.http_port = parsedPort;
    }
  }

  return config;
}

function normalizeConfig(config) {
  if (config.storage && config.storage.postgres) {
    config.storage = {
      type: "postgres",
      db_url: config.storage.postgres.db_url,
      extra: config.storage.postgres.extra || null,
    };
  } else if (!config.storage || config.storage.type !== "postgres") {
    config.storage = { type: "noop" };
  }

  if (!config.overrides) {
    config.overrides = { proxies: {} };
  }
  if (!config.overrides.proxies) {
    config.overrides.proxies = {};
  }

  if (!config.worker) {
    config.worker = { enable: false };
  }
  if (!config.worker.rabbitmq) {
    config.worker.rabbitmq = {
      url: "amqp://guest:guest@localhost:5672",
      concurrency: 5,
    };
  }
  if (typeof config.worker.rabbitmq.concurrency !== "number") {
    config.worker.rabbitmq.concurrency = Number(config.worker.rabbitmq.concurrency || 5);
  }

  if (!config.throttle) {
    config.throttle = {};
  }

  if (config.worker.enable && config.storage.type !== "postgres") {
    throw new Error("When worker mode is enabled, Postgres storage must be configured.");
  }

  return config;
}

function loadTomlConfig(configPath) {
  const resolved = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), "backend_config.toml");

  if (!fs.existsSync(resolved)) {
    return {};
  }

  const content = fs.readFileSync(resolved, "utf8");
  return toml.parse(content);
}

function loadConfig(options = {}) {
  const config = defaultConfig();

  if (options.fromObject && typeof options.fromObject === "object") {
    deepMerge(config, options.fromObject);
  } else {
    const parsed = loadTomlConfig(options.configPath);
    deepMerge(config, parsed);
  }

  applyEnvOverrides(config, options.env || process.env);
  normalizeConfig(config);

  return config;
}

module.exports = {
  defaultConfig,
  loadConfig,
};
