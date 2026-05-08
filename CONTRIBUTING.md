# Contributing to Email Validator

Thanks for your interest in contributing! Contributions of all kinds are welcome — bug fixes, new features, documentation improvements, and test coverage.

---

## Getting started

### 1. Fork and clone

```bash
git clone https://github.com/<your-username>/email-checker.git
cd email-checker
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the dev server

```bash
npm run dev
```

The server starts at `http://127.0.0.1:8080`. The web UI at `/` is useful for manual testing.

For verbose logs while debugging:

```bash
LOG_LEVEL=debug npm run dev
```

You can pipe the JSON output through [`pino-pretty`](https://github.com/pinojs/pino-pretty) for human-readable formatting:

```bash
npm run dev | npx pino-pretty
```

Prometheus metrics are exposed at `GET /metrics`. See the **Observability** section of `README.md` for the metric catalogue.

---

## Running tests

```bash
npm test
```

Tests are in `test/` and cover syntax validation, SMTP response parsing, reachability scoring, config loading, and throttling.

Please add or update tests when your change affects any of these areas. New features should include at least one test that exercises the happy path.

---

## Project structure

```
src/
  checker/    — verification pipeline (syntax → MX → misc → SMTP → scoring)
  http/       — Express routes and middleware
  http/metrics.ts — Prometheus registry + counters/histograms/gauge
  worker/     — RabbitMQ consumer and task execution
  storage/    — Postgres adapter and storage abstraction
  config.ts   — config loading (TOML + env)
  logger.ts   — pino singleton (import as `const { logger } = require("./logger")`)
  runtime.ts  — wires config/storage/throttle/rabbit together

bin/
  email-validator.ts  — CLI entrypoint

test/         — test suite
public/       — static web UI
api/          — Vercel serverless entrypoint
```

The core of the project lives in `src/checker/`. Most contributions will either touch the pipeline there or the HTTP layer in `src/http/`.

---

## Making changes

1. **Create a branch** from `master`:
   ```bash
   git checkout -b fix/your-topic
   ```

2. **Make your changes.** Follow the existing code style — TypeScript, CommonJS output, no semicolons (match the surrounding file).

3. **Build** to confirm there are no type errors:
   ```bash
   npm run build
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

5. **Commit** with a clear message:
   ```bash
   git commit -m "fix: handle empty SMTP banner gracefully"
   ```

6. **Push and open a PR** against the `master` branch.

---

## Pull request guidelines

- Keep PRs focused — one feature or fix per PR
- Describe *why* the change is needed, not just what changed
- If you're fixing a bug, include a reproduction case or link to an issue
- If you're adding a feature, update the relevant documentation (`README.md`, `API_DOCUMENTATION.md`, or `PROJECT_WORKING_AND_FEATURES.md`)

---

## Reporting bugs

Open an issue at [github.com/sagnik11/email-checker/issues](https://github.com/sagnik11/email-checker/issues).

Please include:
- Node.js version (`node --version`)
- What you expected to happen
- What actually happened
- A minimal reproduction (email address, config, curl command, or test case)

---

## Code of conduct

Be respectful and constructive. We're all here to build something useful.

---

## License

By contributing, you agree that your contributions will be licensed under the project's [AGPL-3.0 license](./LICENSE).
