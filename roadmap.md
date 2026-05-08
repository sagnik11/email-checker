# Email Validator Comprehensive Roadmap

This document turns the proposed feature set into an execution-ready roadmap for `check-if-email-exists-master`.
It is designed for a self-hosted deployment model with no paid third-party dependencies, and it explicitly covers:

- Verification accuracy improvements
- Throughput and operational reliability
- Integrations and product UX
- Multi-tenant SaaS readiness

---

## Guiding Principles

1. **Self-hosted first**: Every feature must run with local/open dependencies only.
2. **Backward compatibility**: Existing API response shape should remain stable unless explicitly versioned.
3. **Composable architecture**: New capabilities plug into existing runtime wiring (`src/runtime.ts`) instead of route-local hacks.
4. **Operational visibility**: New behavior ships with metrics, logs, and failure surfaces.
5. **Incremental delivery**: Features are scoped so each can ship independently behind safe defaults.

---

## Current Confirmed Gaps

The codebase currently has these known gaps:

- Bulk `webhook` field exists but is not delivered (`src/worker/service.ts`).
- Rate limiting is process-local in-memory only (`src/throttle.ts`), so replicas diverge.
- No cache layer; all checks rerun DNS + SMTP.
- `/health` does not validate Postgres or RabbitMQ.
- CSV mapper likely targets an outdated nested result shape (`src/http/app.ts`).
- Missing core ops controls: metrics, per-key quotas, bulk UI, dead-letter queue visibility.

These map directly to Tier 1 and Tier 2 priorities.

---

## Tier 1: Quick Wins (Mostly 0.5-1 Day Each)

Focus: fix correctness gaps and add baseline operability with minimal architecture change.

### 1.1 Webhook Delivery for Bulk Tasks

**Goal**  
Activate the already-accepted webhook field so downstream systems can react to task completion.

**Implementation**

- In `src/worker/service.ts`, trigger webhook delivery when a task reaches terminal state.
- Payload shape:
  - `taskId`
  - `email`
  - `result`
  - `jobId`
- Add HMAC-SHA256 signing header:
  - Header: `X-Webhook-Signature`
  - Secret source: `config.ts`
- Retry strategy:
  - 3 attempts
  - Backoff schedule: 1s, 5s, 30s
- On terminal failure, emit structured stdout log with endpoint, job/task identifiers, and final error.

**Acceptance Criteria**

- Webhook fires exactly once on success.
- Retries occur for network/5xx failures.
- Signature verification succeeds in test harness.
- Final failure is clearly logged.

**Tests**

- Unit: signature generation and retry policy.
- Integration: mock webhook endpoint receives signed payload after a bulk run.

---

### 1.2 `/health` and `/ready` Split

**Goal**  
Separate process liveness from dependency readiness for reliable orchestration.

**Status**  
Implemented.

**Implementation**

- Keep `/health` as lightweight process-alive response.
- Add `/ready` in `src/http/app.ts`:
  - Postgres probe: `SELECT 1`
  - RabbitMQ probe: `channel.checkQueue(...)` against configured queue
- Return `503` when either dependency is unavailable, `200` when all are ready.

**Acceptance Criteria**

- Stopping Postgres causes `/ready` -> `503`.
- Stopping RabbitMQ causes `/ready` -> `503`.
- `/health` remains `200` if process is alive.

---

### 1.3 CSV Export Compatibility Fix ✅

**Status**: Done. `mapResultToCsvRow` in `src/http/app.ts` now reads the flat
schema produced by `buildResult` in `src/checker/checkEmail.ts`. Per-verdict
unit tests live in `test/csv-export.test.ts`. CSV columns are documented in
`API_DOCUMENTATION.md` and `public/openapi.yaml`.

**Goal**  
Ensure bulk CSV export reflects the current flat result object.

**Implementation**

- Rewrite `mapResultToCsvRow` in `src/http/app.ts` to map from current `checkEmail.ts` output schema.
- Explicitly map all relevant fields used in API/UI and avoid legacy nested lookups.

**Acceptance Criteria**

- Export does not throw for modern result payloads.
- Rows correctly represent `safe`, `risky`, `invalid`, and `unknown` verdicts.

**Tests**

- Unit test in `test/` for each verdict type.

---

### 1.4 Structured Logging + Prometheus Metrics ✅ Shipped

**Goal**  
Establish production observability baseline.

**Implementation**

- ✅ `pino` + `pino-http` for JSON access logs with request id, method/path/status, latency, and verification verdict when available (`src/logger.ts`, `src/http/app.ts`).
- ✅ `prom-client` exposes `GET /metrics` with the four custom metrics plus default Node process metrics (`src/http/metrics.ts`).
- ✅ Metrics are incremented in both the HTTP path (`src/http/app.ts`) and the worker dequeue path (`src/worker/run.ts`); SMTP errors are classified via the existing parsers in `src/checker/smtpParser.ts`.
- ✅ Sample scrape config at `prometheus.yml`.

**Shipped Metrics**

- `check_email_total{verdict}` — counter
- `check_email_duration_seconds` — histogram
- `bulk_job_active` — gauge
- `smtp_errors_total{reason}` — counter (reason ∈ `invalid` | `full_inbox` | `disabled` | `ip_blacklisted` | `needs_rdns` | `other`)

**Acceptance Criteria**

- ✅ `/metrics` outputs valid Prometheus text format (verified with `test/metrics.test.ts`).
- ✅ Counters/histograms change under request load.
- ✅ Logs are machine-readable JSON.

**Follow-ups (not in this PR)**

- Optional auth gate on `/metrics` (today: relies on private network or proxy auth).
- Add `source="http"|"worker"` label to `check_email_total` if operators need to split.

---

### 1.5 Dead-Letter Queue for Bulk Failures

**Goal**  
Prevent silent task loss and provide visibility for exceeded retry budgets.

**Implementation**

- Configure RabbitMQ DLX in `src/worker/queue.ts` and `src/worker/run.ts`.
- Route exhausted tasks to `dlq.email_check`.
- Add `GET /v1/bulk/:id/failures` to surface failed items and failure reasons.

**Acceptance Criteria**

- Failed tasks move to DLQ after retry exhaustion.
- API endpoint returns failed task list for a job.
- Normal success path remains unchanged.

---

### 1.6 Bulk Result Deduplication ✅ (Shipped)

**Goal**  
Reduce redundant SMTP checks and wasted compute/quota.

**Implementation**

- `dedupeEmails()` in `src/worker/service.ts` collapses the submitted list case-insensitively (after trimming whitespace).
- `/v1/bulk` publishes one task per unique canonical address and persists the original ordered input list on `v1_bulk_job.input_map` (new `jsonb` column).
- `/v1/bulk/:id/results` re-expands the unique results back to one row per submitted input by walking `input_map`, restoring original casing in each row's `input` field.
- `POST /v1/bulk` response now includes `total_inputs`, `unique_inputs`, and `deduplicated`. `GET /v1/bulk/:id` exposes `total_inputs` alongside `total_records`.
- Unit tests live in `test/dedupe.test.ts`.

**Acceptance Criteria**

- ✅ Duplicate addresses are checked once per job.
- ✅ Final job output remains user-complete and deterministic.

---

## Tier 2: Medium-Effort Product Upgrades

Focus: materially improve scalability, tenancy, UX, and verification intelligence.

### 2.1 Postgres-Backed Per-Address Result Cache

**Goal**  
Improve throughput and reduce repeated network costs without introducing Redis.

**Data Model**

- New table: `v1_result_cache`
  - `email_normalized` (PK)
  - `result` (jsonb)
  - `verdict`
  - `expires_at`

**Implementation**

- Add migration via existing auto-migration pattern in `src/storage/postgres.ts`.
- Add read/write cache logic in `src/checker/checkEmail.ts`.
- TTL policy by verdict:
  - `safe`: 7 days
  - `risky`/`invalid`: 24 hours
  - `unknown`: 15 minutes
- Add `force=true` query flag to bypass cache.

**Acceptance Criteria**

- Cache hit avoids DNS/SMTP execution.
- Cache miss executes full pipeline and persists result.
- `force=true` always recomputes.

---

### 2.2 Multi-Tenant API Keys + Quotas

**Goal**  
Replace single shared secret with tenant-safe auth and usage controls.

**Data Model**

- `api_key(id, hashed_key, name, owner, created_at, revoked_at)`
- `api_key_quota(key_id, period, limit, used)`

**Implementation**

- Add `src/http/auth.ts`.
- Update auth middleware in `src/http/app.ts` to resolve key context.
- Store only SHA-256 hash at rest.
- Return raw key only on creation (`eav_...` prefixed).
- Add admin routes:
  - `POST /v1/admin/keys`
  - `GET /v1/admin/keys`
  - `DELETE /v1/admin/keys/:id`
- Guard admin routes with `admin_secret` in config.

**Acceptance Criteria**

- Requests authenticate per key.
- Revoked keys are rejected.
- Quota counters are keyed per API key.

---

### 2.3 Distributed Throttle via Postgres

**Goal**  
Support multiple replicas with a shared limit state while remaining infra-light.

**Implementation**

- Keep throttle abstraction interface.
- Add Postgres-backed strategy in `src/throttle.ts`:
  - token bucket/counter row per key + window
  - atomic `UPDATE ... RETURNING used`
  - advisory locks only where needed for contention control
- Keep optional Redis backend flag for high-QPS users (off by default).

**Acceptance Criteria**

- Rate limiting behaves consistently across replicas.
- Documented QPS ceiling for Postgres mode.

---

### 2.4 Bulk Web UI ✅ shipped

**Goal**  
Make bulk validation usable from the browser without external tooling.

**Shipped**

- New standalone page at `public/bulk.html`, served automatically via the existing `express.static` mount.
- Drag-and-drop CSV upload (or click to browse), client-side quote-aware CSV parsing, header auto-detection, multi-column picker.
- Submits to `POST /v1/bulk`, polls `GET /v1/bulk/:id` every 2s (skips ticks while the tab is hidden), shows progress bar + 4-pill verdict breakdown (safe / risky / invalid / unknown) + elapsed/ETA.
- Download CSV via `GET /v1/bulk/:id/results?format=csv` once the job completes.
- `?job=<id>` URL parameter so a refresh re-attaches polling instead of orphaning the job.
- "Bulk" nav link added to `public/index.html` and `public/docs.html` for discoverability.

---

### 2.5 SSE for Single-Check Progress ✅ Shipped

**Goal**  
Expose pipeline stage visibility to improve user trust and UX.

**Implementation (shipped)**

- `GET /v1/check_email/stream?email=...` in `src/http/app.ts`.
- Emits ordered stages: `syntax` → `mx` → `smtp_connect` → `smtp_rcpt` → `done` (short-circuited stages are omitted; `done` always carries the full `CheckEmailResponse`).
- Progress is threaded through `checkEmail()` and `checkSmtp()` via an optional `onProgress(stage, payload)` callback — no refactor of individual stage modules.
- UI in `public/index.html` consumes the stream via `EventSource` and updates the Syntax / MX / SMTP rows live.
- Auth: accepts either `x-api-secret` header or `api_secret` query parameter (the latter exists because browser `EventSource` cannot send custom headers).
- Worker-mode caveat: the streaming endpoint always runs inline in the API process, even when `worker.enable = true`. The non-streaming `POST /v1/check_email` is unchanged.
- Tests: `test/stream.test.ts` verifies stage ordering, missing-email rejection, and JSON well-formedness of every event payload.

---

### 2.6 Verification Accuracy Upgrades ✅ Shipped

#### 2.6.a SPF/DKIM/DMARC Presence Signals ✅

- TXT-based checks added in `src/checker/misc.ts` (`checkMailAuth`).
- Surfaced response fields:
  - `spf_present` (boolean)
  - `dmarc_policy` (`none` / `quarantine` / `reject` / `null`)
  - `dkim_selectors_found` (string[] — probes 12 common selectors)

#### 2.6.b Greylisting-Aware SMTP Retry ✅

- `isGreylistError(code, message)` in `src/checker/smtpParser.ts` detects 421/450/451/452 greylist deferrals.
- In worker flow, `checkSmtp()` waits `smtp.greylist_retry_ms` (default 60000) and re-probes once.
- Inline HTTP path is unchanged — worker-only behavior is gated by `allowGreylistRetry: true` passed from `src/worker/service.ts`.
- New config knob: `smtp.greylist_retry_ms` (env: `EMAIL_CHECKER__SMTP__GREYLIST_RETRY_MS`).
- New `smtp_error_description` value: `Greylisted`.

#### 2.6.c IDN/Unicode Email Support ✅

- Domains normalized with `url.domainToASCII` in `src/checker/syntax.ts`.
- New `email_domain_unicode` response field preserves the original unicode form for display.
- `email_domain` and `normalized_email` use the ASCII (punycode) form so they remain stable cache/dedupe keys.

#### 2.6.d Free-Mail Provider Expansion ✅

- New `providers` section in `src/data/rules.json` with 50+ `by_domain` entries (Fastmail, Zoho, GMX, Mail.ru, Yandex, Tutanota, Hey, Proton, AOL, QQ, NetEase, Naver, Daum, Rediff, Seznam, WP/Onet/Interia, Libero/Tiscali, Bluewin, Web.de, T-Online, Laposte, Orange, Free, SFR, …) plus `by_mx_suffix` entries.
- `src/checker/provider.ts` exposes `providerFromMx` (preserves hardcoded matchers, falls through to rules.json `by_mx_suffix`) and a new `providerFromDomain` used as a fallback in `checkEmail.ts` when the MX classifier returns `everything_else`.

#### 2.6.e Risk Score 0-100 ✅

- New `risk_score` response field — weighted additive model, clamped to `[0, 100]`.
- Legacy `is_reachable` bucket is preserved unchanged for backward compatibility (computed independently by the existing `calculateReachable()` rules).

**Acceptance Criteria (2.6 overall)**

- ✅ New fields are additive and documented (README, API_DOCUMENTATION.md, openapi.yaml).
- ✅ Existing clients still function with legacy `is_reachable` bucket — semantics unchanged.
- Accuracy changes are measurable on curated test fixtures (model exposed via `calculateRiskScore` export — exercised by `test/risk.test.ts` and `test/parser.test.ts`).

---

### 2.7 Slack/Discord/Zapier Outbound Integrations

**Goal**  
Extend webhook subsystem to event-specific downstream destinations.

**Implementation**

- Reuse webhook delivery core from 1.1.
- Add destination adapters/payload formatters.
- Initial events:
  - `bulk_complete`
  - `quota_low`

**Acceptance Criteria**

- Destination-specific payloads deliver successfully.
- Failures are retried and logged consistently.

---

## Tier 3: Ambitious Flagship Features

Focus: strategic differentiation and SaaS-grade capabilities.

### 3.1 SaaS Admin Console (`/admin`)

**Goal**  
Provide tenancy and operations control from a built-in UI.

**Scope**

- New SPA at `public/admin.html` (vanilla JS).
- Views:
  - tenants and API keys
  - quotas and usage
  - recent jobs
  - error and verdict trends (via `/metrics` + API endpoints)

---

### 3.2 Scheduled List Hygiene

**Goal**  
Continuously re-validate critical lists and notify owners of drift.

**Data Model**

- `monitored_list(id, owner, name, schedule, last_run_at)`

**Implementation**

- Add scheduler loop (cron/tick worker).
- Re-run list on schedule.
- Diff against previous run and deliver webhook summary.

---

### 3.3 Spamtrap/Honeypot Heuristic

**Goal**  
Improve risk detection beyond SMTP reachability.

**Signals**

- Open-source known trap seeds.
- Domain with MX but no A record patterns.
- Suspicious role accounts on high-risk TLDs.
- Recently registered domain approximation via SOA serial heuristics.

**Output**

- `is_likely_trap: boolean`
- `trap_reasons: string[]`

---

### 3.4 Domain Reputation Cache

**Goal**  
Learn from local historical checks to improve future scoring.

**Data Model**

- `domain_stats(domain, total, hard_bounces, catch_all_rate, last_seen)`

**Implementation**

- Update aggregate after each check.
- Feed aggregate signals as priors into the 0-100 risk model.

---

### 3.5 Signed Verification Receipts

**Goal**  
Enable tamper-evident downstream proof of verification outcomes.

**Implementation**

- Sign `{email, verdict, timestamp}` with server-held Ed25519 private key.
- Return `receipt_jws` with responses.
- Expose public key at `/.well-known/email-validator-key`.

---

### 3.6 Official SDKs

**Goal**  
Increase adoption and integration quality.

**Scope**

- `sdk/email-validator-js`
- `sdk/email-validator-py`
- Features:
  - typed responses
  - retries/timeouts
  - webhook signature verifier utility

---

### 3.7 Browser Extension (Manifest v3)

**Goal**  
Bring validation directly to form workflows.

**Scope**

- Extension detects email fields and displays quick verdict pill.
- Calls user’s self-hosted endpoint with user key.
- Requires CORS hardening and key security guidance.

---

## Recommended Execution Order

1. Tier 1 (`1.1` -> `1.6`) to close critical correctness and ops gaps.
2. `2.2` + `2.3` to unlock real multi-tenant SaaS behavior.
3. `2.1` + `2.4` + `2.5` for major throughput and UX gains.
4. `2.6` rolled out incrementally by sub-feature.
5. Tier 3 selected by product strategy:
   - SaaS-first: `3.1`, `3.2`, `3.5`
   - Developer-tool-first: `3.6`, `3.7`

---

## Critical Files and Ownership Map

- `src/worker/service.ts`: webhook delivery, retries, dedupe, scheduled checks
- `src/http/app.ts`: `/ready`, `/metrics`, CSV mapper fix, SSE, admin route wiring
- `src/throttle.ts`: per-key and distributed throttle logic
- `src/storage/postgres.ts`: new table migrations (`v1_result_cache`, keys, quotas, lists, stats)
- `src/checker/misc.ts`: SPF/DKIM/DMARC, trap signal logic, domain prior hooks
- `src/checker/smtp.ts`: greylisting retry and structured SMTP error reasons
- `src/checker/syntax.ts`: IDN/unicode normalization
- `src/checker/checkEmail.ts`: cache path, risk score model, compatibility fields
- `src/data/rules.json` + `src/checker/provider.ts`: provider expansion
- `public/index.html`, `public/bulk.html`, `public/admin.html`: UI surface area
- `src/http/auth.ts`, `src/http/metrics.ts`, `sdk/`: new modules/packages

---

## Reuse Existing Utilities (Do Not Rebuild)

- Extend rule schema through `src/checker/rules.ts` instead of creating parallel config systems.
- Use existing Postgres migration idiom in `src/storage/postgres.ts`.
- Register subsystems centrally in `src/runtime.ts`.
- Reuse SMTP reason parser in `src/checker/smtpParser.ts` for metrics labels.

---

## Testing and Verification Plan (Per Feature)

### Automated

- **Unit tests (Jest)** for isolated logic:
  - CSV mapping
  - HMAC signature generation/verification
  - cache TTL selection
  - quota and throttle accounting
  - risk score weighting behavior
- **Integration tests** with local server (`bin/email-validator.ts serve`) covering:
  - single check
  - bulk submit/poll/export
  - webhook delivery
  - `/ready` degraded dependency states

### Manual Smoke Checklist

1. Open web UI and run single check: `reachable@gmail.com`.
2. Submit 5-row bulk CSV and verify progress + final CSV download.
3. `curl /metrics` and confirm valid Prometheus exposition.
4. Stop Postgres -> `curl /ready` returns `503`; restart -> `200`.
5. Configure request bin webhook and confirm signed payload delivery.

---

## Rollout and Risk Controls

- Ship Tier 1 behind minimal/no flags; these are mostly bug fixes and observability.
- Gate Tier 2+ behavior with config toggles where risk is non-trivial (cache, distributed throttle, scoring model).
- Keep additive response fields preferred over breaking field changes.
- For score model changes, run dual-output period (`legacy_bucket` + `score_0_100`) and compare drift before making score primary.
- Add migration rollback notes for every new table.

---

## Milestone Definition of Done

A milestone is complete only when:

1. Feature behavior is merged with tests.
2. Metrics/logging exist for success and failure paths.
3. Manual smoke checklist passes locally.
4. Documentation (API fields, config knobs, operational notes) is updated.
5. Backward compatibility impact is explicitly called out.

---

## Suggested Milestone Bundles

- **M1: Reliability Foundation**  
  `1.1`, `1.2`, `1.4`, `1.5`
- **M2: Data Correctness + Efficiency**  
  `1.3`, `1.6`, `2.1`
- **M3: SaaS Core**  
  `2.2`, `2.3`
- **M4: UX Upgrade**  
  `2.4`, `2.5`
- **M5: Accuracy Engine**  
  `2.6` (sub-phased)
- **M6: Expansion Paths**  
  Tier 3 set chosen by product direction

---

This roadmap is intentionally modular: each section can be implemented independently while preserving a coherent long-term architecture.
