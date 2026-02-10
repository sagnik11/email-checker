# Rust -> Node Migration Guide

This document explains what was migrated, where each feature is implemented in Node, and how to run and use the system.

## 1) Migration scope

The Node project is in:

- `nodejs/`

It contains:

- core checker pipeline (syntax, MX, misc, SMTP, reachability)
- API routes for `v1` endpoints
- queue worker pipeline with RabbitMQ
- Postgres-backed storage for task and bulk job records
- CLI commands for server, worker, and direct checks
- minimal web interface (`/`)

## 2) File-by-file mapping

### Core checker

- `nodejs/src/checker/checkEmail.js`
  - main pipeline equivalent to Rust `check_email`
  - returns response object with `input`, `is_reachable`, `misc`, `mx`, `smtp`, `syntax`, `debug`
- `nodejs/src/checker/syntax.js`
  - email syntax validation and normalization
  - typo suggestion for known providers
- `nodejs/src/checker/mx.js`
  - MX DNS lookup and preferred host selection
- `nodejs/src/checker/misc.js`
  - disposable/role/B2C checks
  - optional gravatar and HIBP checks
- `nodejs/src/checker/smtp.js`
  - SMTP socket/proxy flow (`EHLO`, `MAIL FROM`, `RCPT TO`, catch-all)
  - retries and error classification
- `nodejs/src/checker/smtpParser.js`
  - SMTP message pattern parser for invalid/full inbox/disabled/blacklist/rDNS
- `nodejs/src/checker/provider.js`
  - provider classification by MX host
- `nodejs/src/checker/rules.js`
  - rule evaluation using migrated `rules.json`

### Data files migrated from Rust

- `nodejs/src/data/roles.txt`
- `nodejs/src/data/b2c.txt`
- `nodejs/src/data/rules.json`

### API layer

- `nodejs/src/http/app.js`
  - all HTTP routes
  - header auth checks (`x-wq-secret`)
  - v1 worker RPC handling
  - bulk progress and results (JSON/CSV)
- `nodejs/src/http/requestMapper.js`
  - request -> checker input mapping
- `nodejs/src/http/errors.js`
  - API error helpers

### Worker and queue

- `nodejs/src/worker/queue.js`
  - RabbitMQ setup, queue declaration, publish helper
- `nodejs/src/worker/run.js`
  - queue consumer loop, throttle behavior, retry/requeue logic
- `nodejs/src/worker/service.js`
  - task execution, webhook callbacks, commercial trial callback
- `nodejs/src/worker/singleShot.js`
  - single-shot worker reply serialization

### Storage and runtime

- `nodejs/src/storage/postgres.js`
  - Postgres schema bootstrap and queries
  - bulk job creation/progress/results and task result persistence
- `nodejs/src/storage/index.js`
  - storage adapter (`postgres` vs `noop`)
- `nodejs/src/throttle.js`
  - in-memory rate limiting manager
- `nodejs/src/config.js`
  - TOML + env config loader (`WQ__...` overrides)
- `nodejs/src/runtime.js`
  - runtime construction (config/storage/throttle/rabbit)

### Entrypoints

- `nodejs/src/server.js` (API server)
- `nodejs/bin/wq-email-checker.js` (installable CLI)
- `nodejs/src/index.js` (library exports)
- `nodejs/public/index.html` (web UI)

## 3) Endpoint behavior

### Version

- `GET /version`
- returns package version

### Single email checks

- `POST /v1/check_email`
  - if `worker.enable = false`: immediate execution + storage write
  - if `worker.enable = true`: RPC-style worker request/reply via RabbitMQ
  - throttle enforced on v1 path

### v1 bulk

- `POST /v1/bulk`
- `GET /v1/bulk/:id`
- `GET /v1/bulk/:id/results?format=json|csv&limit=&offset=`

Requirements:

- `worker.enable = true`
- `storage.postgres.db_url` configured
- RabbitMQ reachable

## 4) Queue model

Queue name:

- `check_email`

Priorities:

- single-shot (`/v1/check_email` with worker): highest priority
- bulk jobs: low priority

Worker behavior:

- checks throttle before processing each message
- requeues unknown SMTP results once (like Rust redelivery behavior)
- requeues non-throttle failures once
- sends RPC reply for single-shot tasks when `replyTo/correlationId` exists

## 5) Storage schema (auto-created)

Tables created on startup when Postgres storage is enabled:

- `v1_bulk_job`
- `v1_task_result`

This supports v1 bulk routes and persisted result retrieval.

## 6) Configuration

Default config file used by CLI/server:

- `nodejs/backend_config.toml`

Env override convention:

- `WQ__SECTION__KEY=value`

Examples:

- `WQ__HTTP_HOST=0.0.0.0`
- `WQ__HTTP_PORT=8080`
- `WQ__HEADER_SECRET=my-secret`
- `WQ__WORKER__ENABLE=true`
- `WQ__WORKER__RABBITMQ__URL=amqp://guest:guest@localhost:5672`
- `WQ__STORAGE__POSTGRES__DB_URL=postgresql://localhost/wq_email_checker_db`

## 7) Running modes

### API only

```bash
wq-email-checker serve --config ./backend_config.toml --no-inline-worker
```

### Worker only

```bash
wq-email-checker worker --config ./backend_config.toml
```

### API + in-process worker

```bash
wq-email-checker serve --config ./backend_config.toml
```

(when `worker.enable = true`)

## 8) CLI usage

Direct check from CLI:

```bash
wq-email-checker check someone@gmail.com --smtp-port 25 --retries 2
```

## 9) Notes on provider-specific methods

Current Node migration always executes SMTP verification for provider checks.

- Yahoo/Hotmail backward-compatible method fields are parsed and accepted.
- Non-SMTP method requests (`api`, `headless`) are accepted and currently fall back to SMTP in execution.

This keeps API compatibility and stable behavior while avoiding brittle browser automation dependencies in the backend runtime.

## 10) How users should use this migration

For production-like deployment:

1. Configure Postgres + RabbitMQ.
2. Set `worker.enable = true` and Postgres URL in config.
3. Run one or more worker processes.
4. Run one or more API server processes.
5. Use `POST /v1/check_email` for single-shot checks.
6. Use `POST /v1/bulk` plus progress/results endpoints for large jobs.

For local quick use:

1. Run `wq-email-checker serve`.
2. Open `http://127.0.0.1:8080/` and test with the web form.
3. Or use `wq-email-checker check someone@gmail.com`.
