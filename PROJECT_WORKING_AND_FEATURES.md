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

Returns a single flat JSON object — `is_reachable` plus every check detail at the top level. No nested objects. Field groups (all top-level):

| Group | Fields | Description |
|---|---|---|
| Verdict | `input`, `is_reachable` | The address checked and the aggregate verdict (`safe`, `risky`, `invalid`, `unknown`) |
| Syntax | `email_address`, `email_username`, `email_domain`, `normalized_email`, `is_valid_syntax`, `syntax_suggestion` | Format validity, parsed parts, normalized form, typo suggestion |
| MX | `mx_accepts_mail`, `mx_records`, `mx_preferred_host`, `mx_preferred_priority`, `mx_lookup_error_type`, `mx_lookup_error_message` | Whether the domain has working MX records and which one was probed |
| SMTP | `smtp_can_connect`, `smtp_has_full_inbox`, `smtp_is_catch_all`, `smtp_is_deliverable`, `smtp_is_disabled_account`, `smtp_error_type`, `smtp_error_message`, `smtp_error_description` | SMTP handshake result and error classification |
| Misc | `is_disposable_email`, `is_role_account`, `is_b2c_provider`, `gravatar_url`, `has_been_pwned` | Disposable, role account, B2C, Gravatar, HaveIBeenPwned |
| Debug | `backend_name`, `check_started_at`, `check_completed_at`, `check_duration_ms`, `check_duration_seconds`, `check_duration_nanos`, `verification_method_type`, `verification_method_host`, `verification_method_smtp_port`, `verification_method_provider`, `verification_method_chosen`, `verification_method_requested`, `verification_method_fallback` | Backend name, timing, verification strategy used |

See [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md) for the full per-field reference.

### Bulk Verification

`POST /v1/bulk` → `GET /v1/bulk/:id` → `GET /v1/bulk/:id/results`

Requires: worker mode + RabbitMQ + Postgres. Submit a list of addresses, poll for progress, retrieve paginated JSON or a full CSV export.

### Queue Worker

- Queue: `check_email` (RabbitMQ)
- Single-shot checks get higher priority than bulk jobs
- Worker applies throttling before processing each message
- Transient SMTP failures (`unknown`) are requeued once
- Results are persisted to Postgres and optionally sent to a webhook (signed with HMAC-SHA256 via `X-Webhook-Signature` when a secret is configured, retried up to 3 times with 1s/5s/30s backoff on 5xx/429/network failures, and structured-logged on terminal failure)

### Postgres Persistence

`src/storage/postgres.ts` auto-migrates two tables on startup (`MIGRATION_SQL`):

- `v1_bulk_job` — `id`, `created_at`, `total_records`.
- `v1_task_result` — `id`, `job_id`, `created_at`, `result` (`jsonb` — the full `CheckEmailResponse`), `extra` (`jsonb` — opaque metadata), `error` (text — populated when a task threw).

Aggregate progress (`safe_count`, `risky_count`, `invalid_count`, `unknown_count`, `total_processed`) is computed on the fly from `v1_task_result` — no separate counter table to keep in sync.

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

`calculateReachable()` in `src/checker/checkEmail.ts` evaluates verdicts in this order:

| Order | Verdict | Trigger |
|---|---|---|
| 1 | `unknown` | An SMTP error is present (timeout, blacklist, rDNS, …) |
| 2 | `risky`   | `is_disposable` ∨ `is_role_account` ∨ `is_catch_all` ∨ `has_full_inbox` |
| 3 | `invalid` | `!is_deliverable` ∨ `!can_connect_smtp` ∨ `is_disabled` |
| 4 | `safe`    | None of the above |

Syntax failure short-circuits to `invalid` before this matrix runs. MX-lookup failures yield `invalid` (soft DNS errors) or `unknown` (hard DNS errors).

### SMTP rules engine

`src/data/rules.json` stores per-domain and per-MX overrides applied in `src/checker/rules.ts`:

- `SkipCatchAll` — skip the random-address probe (Gmail / Hotmail / Yahoo always accept random RCPTs and would otherwise look catch-all).
- `SmtpTimeout45s` — bump the SMTP timeout to ≥ 45 s for slow / greylisting servers.

Rules can target a domain, an MX hostname, or both. They're loaded into in-memory Sets at startup.

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

### Worker scaling

- Workers consume from the `check_email` RabbitMQ queue with prefetch = `worker.rabbitmq.concurrency` (default 5). Increase concurrency for higher throughput per worker.
- Run as many worker replicas as you need — they share the queue, so adding workers scales horizontally without coordination.
- Single-shot RPC checks (synchronous `POST /v1/check_email` in worker mode) are published with the highest priority; bulk job tasks use priority 1. The RabbitMQ broker delivers higher priority first.
- Transient SMTP failures (`unknown`) are requeued once before the result is persisted.
- Suggested monitoring: queue depth via the RabbitMQ management UI / Prometheus exporter, worker liveness via `GET /health` on each replica, job progress via `GET /v1/bulk/:id` or by querying `v1_task_result` directly.
- For verbose SMTP transaction logs, set `SMTP_DEBUG=true` on the worker process — every `EHLO` / `MAIL FROM` / `RCPT TO` / `QUIT` is emitted as a JSON line to stdout.

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
