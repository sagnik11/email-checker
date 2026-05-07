# Architecture & Feature Reference

A deep-dive into how Email Validator works under the hood — the verification pipeline, runtime modes, storage model, and production checklist.

---

## Overview

Email Validator is a TypeScript backend that verifies email addresses without sending mail. It combines five distinct checks into a single structured response and exposes them via HTTP API, CLI, and an optional queue worker for async bulk processing.

---

## Repository Layout

```
src/
  checker/         — core verification pipeline (syntax, MX, SMTP, misc, scoring)
  http/            — Express route handlers and middleware
  worker/          — RabbitMQ queue setup, consumer loop, task execution
  storage/         — storage abstraction + Postgres implementation
  config.ts        — TOML + env config loader
  runtime.ts       — runtime object construction
  server.ts        — HTTP server entrypoint

bin/
  email-validator.ts   — installable CLI entrypoint

api/
  index.ts         — Vercel serverless entrypoint

public/
  index.html       — browser-based quick-check UI

test/              — test suite
```

---

## Core Features

### Single Email Verification

`POST /v1/check_email`

Returns a structured object with:

| Field | Description |
|---|---|
| `input` | The address that was checked |
| `is_reachable` | Verdict: `safe`, `risky`, `invalid`, or `unknown` |
| `syntax` | Format validity, parsed username/domain, typo suggestions |
| `mx` | Whether the domain has working MX records |
| `smtp` | SMTP handshake result and error classification |
| `misc` | Disposable, role account, B2C, Gravatar, HaveIBeenPwned |
| `debug` | Backend name, timing |

### Bulk Verification

`POST /v1/bulk` → `GET /v1/bulk/:id` → `GET /v1/bulk/:id/results`

Requires: worker mode + RabbitMQ + Postgres. Submit a list of addresses, poll for progress, retrieve paginated JSON or a full CSV export.

### Queue Worker

- Queue: `check_email` (RabbitMQ)
- Single-shot checks get higher priority than bulk jobs
- Worker applies throttling before processing each message
- Transient SMTP failures (`unknown`) are requeued once
- Results are persisted to Postgres and optionally sent to a webhook

### Postgres Persistence

Tables auto-created on startup:

- `v1_bulk_job` — job metadata, status, progress
- `v1_task_result` — individual address results linked to a job

### Rate Limiting

In-memory throttle with configurable limits per second, minute, hour, and day. Applied at both the HTTP layer and inside the worker loop.

### CLI

```bash
email-validator check someone@gmail.com
email-validator serve --config ./backend_config.toml
email-validator worker --config ./backend_config.toml
```

### Web UI

Served at `/`. Calls `POST /v1/check_email` and displays results in the browser — useful for quick manual checks.

---

## Verification Pipeline (single email)

Orchestrated in `src/checker/checkEmail.ts`. Stages run in order:

### 1. Syntax

- RFC-compliant format validation
- Username and domain extraction
- Known-provider normalization (strips plus-aliases, dots, etc.)
- Typo suggestions for common domains (`gmail.co` → `gmail.com`)

### 2. MX

- Resolves MX DNS records for the domain
- Ranks records by preference
- Marks the check `invalid` if no mail-accepting records are found

### 3. Misc

- Disposable domain detection (via `disposable-email-domains` + `mailchecker`)
- Role account detection (`info@`, `admin@`, `noreply@`, etc.)
- B2C provider classification (Gmail, Outlook, Yahoo, etc.)
- Optional Gravatar URL lookup
- Optional HaveIBeenPwned breach check

### 4. SMTP

- Opens a TCP connection to the best MX host (or via SOCKS5 proxy)
- Sends `EHLO`, `MAIL FROM`, `RCPT TO`
- Detects catch-all domains
- Parses SMTP error responses into typed outcomes:
  - full inbox
  - disabled/suspended account
  - blacklisted sender
  - reverse DNS rejection
- Applies retry behavior for transient failures

### 5. Reachability Scoring

| Verdict | Conditions |
|---|---|
| `invalid` | Syntax failure, no MX, hard SMTP rejection |
| `risky` | Disposable, role account, catch-all, soft bounce |
| `safe` | Deliverable, non-risky |
| `unknown` | Network timeout, greylisting, ambiguous provider response |

---

## HTTP API Behavior

App setup: `src/http/app.ts`

### Authentication

If `header_secret` is configured, all protected routes require:

```http
x-api-secret: <secret>
```

### `POST /v1/check_email` — execution modes

| `worker.enable` | Behavior |
|---|---|
| `false` (default) | Check runs in-process synchronously |
| `true` | Request is dispatched to RabbitMQ; API waits for worker reply (RPC pattern) |

Throttle is checked before either path.

### `POST /v1/bulk`

1. Creates a `v1_bulk_job` record in Postgres
2. Enqueues each address as a low-priority task
3. Returns `job_id` immediately

Results become available as the worker processes tasks.

---

## Worker Internals

Key files: `src/worker/run.ts`, `src/worker/service.ts`, `src/worker/queue.ts`

Consumer loop per message:

1. Parse and validate task payload
2. Apply throttle — nack and discard if over limit
3. Execute the check pipeline
4. On `unknown` SMTP result → requeue once
5. On other transient failure → requeue once
6. Persist result to Postgres
7. If message has `replyTo` / `correlationId` → send RPC reply (single-shot mode)
8. Ack message

---

## Configuration

Loaded by `src/config.ts` in merge order:

1. Built-in defaults
2. `backend_config.toml` (or path passed via `--config`)
3. Environment variables (`EMAIL_CHECKER__SECTION__KEY`)
4. `PORT` env var → `http_port` fallback

Full reference: [`README.md` — Configuration](./README.md#configuration)

---

## Runtime Modes

### API only (no worker)

```bash
email-validator serve --config ./backend_config.toml --no-inline-worker
```

### Worker only

```bash
email-validator worker --config ./backend_config.toml
```

### API + inline worker (single process)

```bash
email-validator serve --config ./backend_config.toml
# with worker.enable = true in config
```

Use the inline mode for simple self-hosted setups. For high-throughput production use, run API and worker as separate scaled processes.

---

## Vercel Deployment

- `api/index.ts` wraps the Express app as a Vercel serverless function
- `vercel.json` configures routing

Best for: single-check API (`/v1/check_email`). Bulk + worker mode requires long-running infrastructure that doesn't fit the serverless model.

---

## Testing

```bash
npm test
```

Current test coverage:

| Area | Tests |
|---|---|
| Syntax validation & normalization | ✅ |
| SMTP response parser | ✅ |
| Reachability scoring | ✅ |
| Config env override loading | ✅ |
| Throttling behavior | ✅ |

---

## Production Checklist

- [ ] Set a strong `header_secret`
- [ ] Configure `hello_name` and `from_email` to match your domain
- [ ] Enable Postgres and RabbitMQ for bulk/worker mode
- [ ] Run at least one worker replica
- [ ] Set throttle thresholds appropriate for your traffic
- [ ] Configure CORS origins if serving a browser frontend
- [ ] Set up health check monitoring at `GET /health`
- [ ] Use a SOCKS5 proxy if your host's outbound port 25 is blocked
