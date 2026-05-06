# Project Working And Features

This document explains the architecture, runtime flow, and deployment model of `Email Validation Service`.

## 1) Overview

`Email Validation Service` is a TypeScript email verification backend and CLI.

It verifies an email address without sending mail by combining:

- syntax validation
- MX lookup
- SMTP handshake checks
- metadata enrichment (disposable, role account, B2C traits)
- optional Gravatar and HaveIBeenPwned checks

The project supports both synchronous API checks and asynchronous queue-backed bulk processing.

## 2) Repository Layout

- `src/` - application code
  - `src/checker/` - syntax, MX, SMTP, scoring, misc checks
  - `src/http/` - Express API handlers
  - `src/worker/` - RabbitMQ queue setup and worker loop
  - `src/storage/` - storage abstraction + Postgres implementation
- `bin/email-validator.ts` - CLI entrypoint
- `public/` - static web UI served at `/`
- `test/` - test suite
- `api/index.ts` - Vercel serverless entrypoint
- `README.md` - quick start and operational summary

## 3) Core Features

### 3.1 Single Email Verification

Endpoint:

- `POST /v1/check_email`

Returns structured output with:

- `input`
- `is_reachable` (`safe`, `risky`, `invalid`, `unknown`)
- `syntax`, `mx`, `smtp`, `misc`
- `debug` details when present

### 3.2 Bulk Verification

Endpoints:

- `POST /v1/bulk`
- `GET /v1/bulk/:id`
- `GET /v1/bulk/:id/results?format=json|csv&limit=&offset=`

Bulk mode requires worker + queue + Postgres storage.

### 3.3 Queue Worker Architecture

- RabbitMQ queue name: `check_email`
- Worker consumes and processes queued tasks
- Single check can use RPC-style worker roundtrip when worker mode is enabled
- Bulk jobs enqueue at lower priority than single-shot checks

### 3.4 Postgres Persistence

With Postgres storage enabled, the service persists:

- bulk jobs
- task results
- progress and retrieval metadata for bulk endpoints

### 3.5 Throttling

In-memory throttling can enforce limits by:

- second
- minute
- hour
- day

It is applied in API request processing and worker task handling.

### 3.6 CLI

Global binary:

- `email-validator`

Commands:

- `serve`
- `worker`
- `check`

### 3.7 Web UI

- Available at `/`
- Calls `POST /v1/check_email`
- Intended for quick manual validation

## 4) Verification Pipeline (Single Email)

Main orchestration:

- `src/checker/checkEmail.ts`

Execution order:

1. **Syntax stage**
   - validates format
   - extracts username/domain
   - normalizes known-provider formats
   - suggests likely provider typo fixes
2. **MX stage**
   - resolves MX records
   - ranks by preference
   - marks invalid path when DNS mail routing is missing
3. **Misc stage**
   - disposable domain detection
   - role account detection
   - B2C provider traits
   - optional Gravatar lookup
   - optional HaveIBeenPwned lookup
4. **SMTP stage**
   - connects directly or via SOCKS5
   - sends `EHLO`, `MAIL FROM`, `RCPT TO`
   - optional catch-all detection
   - parses SMTP errors into typed outcomes
   - applies retry behavior
5. **Reachability scoring**
   - `invalid` for clear failure states
   - `risky` for potentially deliverable but risky states
   - `safe` for deliverable non-risk outcomes
   - `unknown` for inconclusive network/provider scenarios

## 5) HTTP API Behavior

App setup:

- `src/http/app.ts`

### 5.1 Header Secret

If `header_secret` is configured, protected endpoints require:

- `x-api-secret: <secret>`

### 5.2 `POST /v1/check_email`

- With `worker.enable = false`: executes in-process synchronously
- With `worker.enable = true`: dispatches via RabbitMQ and waits for worker reply
- applies throttle checks before processing

### 5.3 `POST /v1/bulk`

Requires:

- `worker.enable = true`
- Postgres storage configured
- RabbitMQ available

Flow:

1. create bulk job record
2. enqueue each email as a task
3. return `job_id`

### 5.4 Bulk Results

`GET /v1/bulk/:id/results` supports:

- JSON paging
- CSV output (`format=csv`)
- `limit` and `offset`

## 6) Worker Internals

Key files:

- `src/worker/run.ts`
- `src/worker/service.ts`
- `src/worker/singleShot.ts`
- `src/worker/queue.ts`

Worker loop behavior:

1. consume queue message
2. parse and validate task payload
3. apply throttling policy
4. process check task
5. retry/requeue specific transient outcomes
6. ack/nack appropriately
7. persist result
8. optionally send RPC single-shot reply

## 7) Storage Model

Postgres implementation:

- `src/storage/postgres.ts`

Storage adapter selection:

- `src/storage/index.ts`

When enabled, required tables are auto-created and used for bulk job tracking and result retrieval.

## 8) Configuration Model

Config loader:

- `src/config.ts`

Config sources (merge order):

1. defaults
2. `backend_config.toml` (or explicit `configPath`)
3. env overrides (`EMAIL_CHECKER__...`)
4. `PORT` fallback for `http_port`

Examples:

- `EMAIL_CHECKER__HTTP_HOST=0.0.0.0`
- `EMAIL_CHECKER__HTTP_PORT=8080`
- `EMAIL_CHECKER__HEADER_SECRET=my-secret`
- `EMAIL_CHECKER__WORKER__ENABLE=true`
- `EMAIL_CHECKER__WORKER__RABBITMQ__URL=amqp://guest:guest@localhost:5672`
- `EMAIL_CHECKER__STORAGE__POSTGRES__DB_URL=postgresql://localhost/email_checker_db`

## 9) Runtime Modes

### 9.1 API Only (No Worker Inline)

```bash
email-validator serve --config ./backend_config.toml --no-inline-worker
```

### 9.2 Worker Only

```bash
email-validator worker --config ./backend_config.toml
```

### 9.3 API + Inline Worker

```bash
email-validator serve --config ./backend_config.toml
```

Use when `worker.enable = true` and you want a simpler single-process runtime.

## 10) Vercel Deployment Model

Vercel integration files:

- `api/index.ts`
- `vercel.json`

Behavior:

- Vercel serves the Express app through a serverless function.
- Best suited for synchronous API checks and low operational overhead.
- Bulk queue workflow is not ideal for pure serverless runtime.

Production recommendation:

- Use Vercel for API entry when needed.
- Run worker + RabbitMQ + Postgres on dedicated infrastructure for reliable bulk processing.

## 11) Testing

Current tests include:

- syntax and normalization
- SMTP parser categorization
- reachability baseline checks
- config env override behavior
- throttling behavior

Run tests:

```bash
npm test
```

## 12) Operational Checklist

For production-grade setup:

1. configure secrets and SMTP identity
2. configure Postgres and RabbitMQ
3. enable worker mode for async/bulk workloads
4. run worker replicas
5. run API replicas
6. enable `header_secret` for trusted access paths
7. set throttling thresholds for expected traffic

## 13) Sponsorship

This project is sponsored by **Autter**.
