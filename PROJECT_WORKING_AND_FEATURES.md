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

### Single Email Verification (Streaming)

`GET /v1/check_email/stream?email=...`

Same pipeline as `POST /v1/check_email`, but each pipeline stage is emitted to the client as a Server-Sent Event the moment it completes. The UI uses this to show real progress instead of a fake spinner. Stages: `syntax`, `mx`, `smtp_connect`, `smtp_rcpt`, `done` (terminal frame carries the full `CheckEmailResponse`). Short-circuited stages (e.g. invalid syntax skips `mx`/`smtp_*`) are simply omitted before `done`. Authentication accepts either the `x-api-secret` header or an `api_secret` query parameter — the latter exists because browser `EventSource` cannot send custom headers. Always runs inline in the API process even when worker mode is enabled.

### Bulk Verification

`POST /v1/bulk` → `GET /v1/bulk/:id` → `GET /v1/bulk/:id/results` (or `GET /v1/bulk/:id/failures` for retry-exhausted tasks)

Requires: worker mode + RabbitMQ + Postgres. Submit a list of addresses, poll for progress, retrieve paginated JSON or a full CSV export. CSV columns mirror the flat JSON keys (`is_reachable`, `email_address`, `is_disposable_email`, `smtp_is_deliverable`, …) — see [`API_DOCUMENTATION.md` → "CSV columns"](./API_DOCUMENTATION.md#csv-columns) for the full list.  Tasks that exceed the retry budget are routed to a dead-letter queue and surfaced via the `/failures` endpoint.

The submitted list is deduplicated case-insensitively (after trimming whitespace) before tasks are published, so each unique address is only checked once per job. The original input list is persisted on the `v1_bulk_job` row and replayed at result-fetch time, so the JSON / CSV output still contains exactly one row per submitted input — same casing, same order, same multiplicity. The `POST /v1/bulk` response surfaces `total_inputs`, `unique_inputs`, and `deduplicated` so callers can see how much work was saved.

### Queue Worker

- Queue: `check_email` (RabbitMQ)
- Single-shot checks get higher priority than bulk jobs
- Worker applies throttling before processing each message
- Transient SMTP failures (`unknown`) are requeued once
- Results are persisted to Postgres and optionally sent to a webhook (signed with HMAC-SHA256 via `X-Webhook-Signature` when a secret is configured, retried up to 3 times with 1s/5s/30s backoff on 5xx/429/network failures, and structured-logged on terminal failure)

### Postgres Persistence

`src/storage/postgres.ts` auto-migrates two tables on startup (`MIGRATION_SQL`):

- `v1_bulk_job` — `id`, `created_at`, `total_records` (count of unique addresses checked), `input_map` (`jsonb` — the original submitted list, used to expand results back to one row per input).
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

Served at `/`. Consumes `GET /v1/check_email/stream` over `EventSource` and renders pipeline stages live, then displays the final result panel when the `done` event arrives.

### Observability

- **Structured logs.** `pino` is the application logger; `pino-http` emits one JSON access log per HTTP request with `req.id`, method, URL, status, latency, and (for `/v1/check_email`) the resolved verdict. Set `LOG_LEVEL` to override the default (`info`).
- **Prometheus metrics.** `prom-client` exposes `GET /metrics` with `check_email_total{verdict}`, `check_email_duration_seconds` (histogram), `bulk_job_active` (gauge), and `smtp_errors_total{reason}`, alongside the default Node process metrics. Reason labels are derived from the existing classifiers in `src/checker/smtpParser.ts` (`invalid`, `full_inbox`, `disabled`, `ip_blacklisted`, `needs_rdns`, `other`).
- A sample scrape config lives at `prometheus.yml`. The endpoint is unauthenticated — keep it private.

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

1. Deduplicates the submitted addresses case-insensitively via `dedupeEmails()` in `src/worker/service.ts`
2. Creates a `v1_bulk_job` row in Postgres, persisting the original input list as `input_map` and `total_records = uniqueEmails.length`
3. Enqueues one low-priority task per unique address with the canonicalized (lowercased + trimmed) `to_email`
4. Returns `{ job_id, total_inputs, unique_inputs, deduplicated }` immediately

Results become available as the worker processes tasks. `GET /v1/bulk/:id/results` re-expands the unique results back to one row per submitted input by walking `input_map` in original order, preserving the originally-submitted casing in each row's `input` field.

---

## Worker Internals

Key files: `src/worker/run.ts`, `src/worker/service.ts`, `src/worker/queue.ts`

Consumer loop per message:

1. Parse and validate task payload
2. Apply throttle — nack with requeue if over limit (transient; does not consume retry budget)
3. Execute the check pipeline
4. On `unknown` SMTP result → requeue once
5. On other transient failure → requeue once
6. After the second attempt still fails for a bulk task → publish to the dead-letter exchange `dlx.email_check` with `x-last-error` and `x-attempts` headers, then ack
7. Persist result to Postgres on success (or on second-attempt success/unknown for non-bulk tasks)
8. If message has `replyTo` / `correlationId` → send RPC reply (single-shot mode)
9. Ack message

A second consumer drains `dlq.email_check`. For each dead-lettered message it inserts:

- a row into `v1_dlq_task` (the failure log surfaced by `GET /v1/bulk/:id/failures`)
- a row into `v1_task_result` with the `error` column populated, so `getV1BulkProgress` and `countV1Processed` continue to mark the task as processed and the job can complete.

The `check_email` queue is declared with `deadLetterExchange: "dlx.email_check"` and `deadLetterRoutingKey: "check_email"`. The DLQ uses `nack(requeue=false)` semantics implicitly — the worker chooses to `publish` directly to the DLX so it can attach the human-readable last-error message that AMQP's `x-death` header does not carry.

### Storage tables

| Table | Purpose |
|---|---|
| `v1_bulk_job` | One row per bulk job submission |
| `v1_task_result` | One row per processed task (success or failure) |
| `v1_dlq_task` | One row per dead-lettered task (retry-budget exhausted) |

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
- Suggested monitoring: queue depth via the RabbitMQ management UI / Prometheus exporter, process liveness via `GET /health`, dependency readiness via `GET /ready`, and job progress via `GET /v1/bulk/:id` (or by querying `v1_task_result` directly).
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
- [ ] Set up liveness monitoring at `GET /health` and readiness monitoring at `GET /ready`
- [ ] Use a SOCKS5 proxy if your host's outbound port 25 is blocked
