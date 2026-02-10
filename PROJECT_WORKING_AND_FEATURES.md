# Project Working And Features

This document explains how the Node.js project works end-to-end, what features are included, and how users should run it in local and production-style setups.

## 1. What this project is

`wq-email-checker` is an email verification backend and CLI.

It validates an email address without sending an actual message by combining:

- syntax validation
- MX DNS checks
- SMTP conversation checks
- metadata checks (disposable/role/B2C)
- optional Gravatar and HaveIBeenPwned checks

It also supports bulk workflows, queue-based worker processing, and persisted results.

## 2. Repository structure (current)

- `nodejs/`: complete Node.js implementation (API, worker, storage, checker, CLI)
- `README.md`: root quick start
- `PROJECT_WORKING_AND_FEATURES.md`: this detailed project doc
- `nodejs/MIGRATION.md`: Rust->Node migration mapping and notes

## 3. Core features

### 3.1 Single email verification

Supported endpoints:

- `POST /v1/check_email`

Both return a detailed JSON object including:

- `input`
- `is_reachable` (`safe`, `risky`, `invalid`, `unknown`)
- `misc`
- `mx`
- `smtp`
- `syntax`
- `debug`

### 3.2 Bulk verification

Supported endpoints:

- `POST /v1/bulk`
- `GET /v1/bulk/:id`
- `GET /v1/bulk/:id/results?format=json|csv&limit=&offset=`

### 3.3 Queue worker architecture

- RabbitMQ queue: `check_email`
- Worker consumes tasks and processes them asynchronously
- Single-shot v1 can use RPC-style request/reply over RabbitMQ
- Bulk tasks are queued at lower priority than single-shot tasks

### 3.4 Postgres persistence

When Postgres storage is enabled, the service persists:

- v1 bulk jobs and task results
- single-shot results (v1 path)

### 3.5 Throttling

In-memory throttle manager supports rate limits by:

- second
- minute
- hour
- day

Used by v1 request path and worker processing flow.

### 3.6 Installable CLI

Global binary name:

- `wq-email-checker`

Commands:

- `serve`: run HTTP server
- `worker`: run worker only
- `check`: run one-off email verification from terminal

### 3.7 Web interface

- Served at `/`
- Simple form-based interface calling `POST /v1/check_email`
- Useful for quick manual checks

## 4. How verification works (single email)

Main implementation: `nodejs/src/checker/checkEmail.js`

Pipeline order:

1. Syntax check
- validates email format
- extracts username/domain
- computes normalized email for compatible providers
- generates typo suggestion for common domains when relevant

2. MX check
- resolves MX records
- sorts by priority and selects preferred host
- if no MX records, marks invalid reachability path

3. Misc check
- disposable detection
- role account detection
- B2C provider detection
- optional Gravatar lookup
- optional HaveIBeenPwned lookup (if API key is supplied)

4. SMTP check
- opens SMTP socket (direct or SOCKS5)
- sends `EHLO`, `MAIL FROM`, `RCPT TO`
- optional catch-all detection via random recipient
- parses response patterns for invalid/full-inbox/disabled/blacklist/rDNS
- applies retry logic

5. Reachability scoring
- `unknown` when SMTP stage cannot produce a definitive result
- `risky` for disposable/role/catch-all/full-inbox
- `invalid` for undeliverable/non-connectable/disabled
- `safe` otherwise

## 5. HTTP API behavior

Main router: `nodejs/src/http/app.js`

### 5.1 Authentication header

Optional config:

- `header_secret`

If set, endpoints require:

- header: `x-wq-secret: <secret>`

### 5.2 `/v1/check_email`

- If `worker.enable = false`: immediate in-process verification
- If `worker.enable = true`: request is pushed to worker and waits for RPC response
- Throttling enforced before processing

### 5.3 `/v1/bulk`

Requires all:

- `worker.enable = true`
- Postgres storage enabled
- RabbitMQ connection available

Flow:

- creates a `v1_bulk_job` record
- enqueues tasks
- returns `job_id`

### 5.4 Results endpoints

v1 supports:

- JSON result pages (default capped page size behavior for JSON)
- CSV output via `format=csv`
- `limit` and `offset` for paging

## 6. Worker internals

Core files:

- `nodejs/src/worker/run.js`
- `nodejs/src/worker/service.js`
- `nodejs/src/worker/singleShot.js`
- `nodejs/src/worker/queue.js`

Behavior:

- consume tasks from `check_email`
- throttle gate
- process verification task
- store output
- send single-shot RPC reply when required
- requeue certain failures once (unknown/error retry behavior)

Optional extras:

- webhook callback per task (when present in task payload)
- commercial trial callback forwarding (if configured)

## 7. Database model

Auto-created by `nodejs/src/storage/postgres.js` when Postgres storage is active.

Tables:

- `v1_bulk_job`
- `v1_task_result`

Purpose:

- `v1_bulk_job`, `v1_task_result`: v1 worker-centric tracking/results

## 8. Configuration model

Config loader: `nodejs/src/config.js`

Sources:

1. TOML file (default `nodejs/backend_config.toml`)
2. env overrides (`WQ__...` style)
3. `PORT` fallback for HTTP port

Examples:

- `WQ__HTTP_HOST=0.0.0.0`
- `WQ__HTTP_PORT=8080`
- `WQ__HEADER_SECRET=my-secret`
- `WQ__WORKER__ENABLE=true`
- `WQ__WORKER__RABBITMQ__URL=amqp://guest:guest@localhost:5672`
- `WQ__STORAGE__POSTGRES__DB_URL=postgresql://localhost/wq_email_checker_db`

## 9. Runtime modes

### 9.1 API only

Use when you want synchronous checks and no worker in the API process.

```bash
wq-email-checker serve --config ./backend_config.toml --no-inline-worker
```

### 9.2 Worker only

Use when API and worker are deployed separately.

```bash
wq-email-checker worker --config ./backend_config.toml
```

### 9.3 API + inline worker

Use for simpler single-process deployments.

```bash
wq-email-checker serve --config ./backend_config.toml
```

(when `worker.enable = true`)

## 10. User workflows

### 10.1 Quick manual check

1. start API
2. open `/`
3. submit an email

### 10.2 Programmatic single checks

Use `POST /v1/check_email`.

### 10.3 Large batch verification

1. enable worker + Postgres + RabbitMQ
2. `POST /v1/bulk`
3. poll `GET /v1/bulk/:id`
4. fetch final output from `GET /v1/bulk/:id/results`

### 10.4 CLI one-off checks

```bash
wq-email-checker check someone@gmail.com
```

## 11. Included test coverage

Current tests cover:

- syntax/normalization
- parser classifications
- reachability basics
- config override mapping
- throttle behavior

Run:

```bash
cd nodejs
npm test
```

## 12. Important current behavior notes

- Provider-specific non-SMTP methods are accepted in request shapes for compatibility and currently fall back to SMTP execution.
- Bulk endpoints require Postgres storage to be configured.
- v1 bulk additionally requires worker mode and RabbitMQ availability.

## 13. Operational checklist

For production-like operation:

1. Configure Postgres and RabbitMQ.
2. Set worker mode and storage config.
3. Run one or more worker processes.
4. Run one or more API processes.
5. Enable header secret for trusted client access if needed.
6. Set throttle limits for your environment.

This gives you single-check and bulk verification with persisted results and queue-backed scaling.
