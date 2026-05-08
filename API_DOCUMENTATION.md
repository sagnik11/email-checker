# API Reference

Complete reference for integrating with the Email Validator HTTP API.

> 📄 A machine-readable **OpenAPI 3.1** spec is available at [`public/openapi.yaml`](./public/openapi.yaml) (served at `/openapi.yaml` when the server is running). Drop it into Swagger UI, Redoc, or `openapi-generator` to scaffold a typed client.

---

## Base URL

| Environment | URL |
|---|---|
| Local dev | `http://127.0.0.1:8080` |
| Production | `https://your-domain.com` |

All examples below use:

```bash
BASE_URL=http://127.0.0.1:8080
```

---

## Authentication

If `header_secret` is set in your server config, every protected endpoint must include:

```http
x-api-secret: <your-secret>
```

A missing or wrong secret returns `400`.

**Tip:** To allow your own web UI (served on the same origin) to call the API without the secret header, set:

```env
EMAIL_CHECKER__ALLOW_BROWSER_WITHOUT_SECRET=true
```

This bypass only applies to same-origin browser requests (checked via `Origin`/`Referer`).

---

## CORS

For browser-based apps calling the API cross-origin, configure allowed origins:

```env
EMAIL_CHECKER__CORS__ORIGINS=https://app.example.com,https://www.app.example.com
```

Default: `*` (all origins allowed).

---

## Content Type

All request bodies must be JSON:

```http
Content-Type: application/json
```

---

## Endpoints

### Health Check

**`GET /health`**

Lightweight liveness probe. Returns `200` when the HTTP process is running.

```bash
curl "$BASE_URL/health"
```

```json
{ "ok": true }
```

---

### Readiness Check

**`GET /ready`**

Dependency readiness probe for orchestration. Returns:

- `200` only when both Postgres and RabbitMQ are reachable
- `503` when either dependency is unavailable

```bash
curl "$BASE_URL/ready"
```

```json
{
  "ok": true,
  "dependencies": {
    "postgres": { "ok": true },
    "rabbitmq": { "ok": true, "queue": "check_email" }
  }
}
```

---

### Version

**`GET /version`**

Returns the current package version.

```bash
curl "$BASE_URL/version"
```

```json
{ "version": "0.2.0" }
```

---

### Metrics

**`GET /metrics`**

Returns Prometheus exposition format (text v0.0.4). Unauthenticated — expose only on a private network or behind your auth proxy.

```bash
curl "$BASE_URL/metrics"
```

Response headers: `Content-Type: text/plain; version=0.0.4; charset=utf-8`.

Custom metrics:

| Metric | Type | Labels |
|---|---|---|
| `check_email_total` | counter | `verdict` ∈ {`safe`, `risky`, `invalid`, `unknown`} |
| `check_email_duration_seconds` | histogram | — (buckets: 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30) |
| `bulk_job_active` | gauge | — |
| `smtp_errors_total` | counter | `reason` ∈ {`invalid`, `full_inbox`, `disabled`, `ip_blacklisted`, `needs_rdns`, `other`} |

Default `process_*` and `nodejs_*` metrics from `prom-client` are also exported.

A sample scrape config lives at [`prometheus.yml`](./prometheus.yml) in the repo root.

---

### Single Email Validation

**`POST /v1/check_email`**

Validates one email address synchronously. Returns a structured result with syntax, DNS, SMTP, and metadata checks.

#### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `to_email` | string | ✅ | The email address to validate |
| `check_gravatar` | boolean | | Fetch Gravatar profile image URL |
| `haveibeenpwned_api_key` | string | | Check address against HaveIBeenPwned breach database (falls back to `EMAIL_CHECKER_HIBP_API_KEY` env var) |
| `proxy` | object | | SOCKS5 proxy. See [Proxy object](#proxy-object) below |
| `hello_name` | string | | Override EHLO domain sent to remote SMTP (only honored when `proxy` is set) |
| `from_email` | string | | Override MAIL FROM address (only honored when `proxy` is set) |
| `smtp_timeout` | number | | SMTP connection timeout in **seconds** (only honored when `proxy` is set) |
| `smtp_port` | number | | SMTP port, default `25` (only honored when `proxy` is set; the `EMAIL_CHECKER_SMTP_PORT` env var wins over this) |
| `yahoo_verif_method` | `"api"` \| `"headless"` \| `"smtp"` | | Yahoo verification strategy (default `smtp`) |
| `hotmailb2c_verif_method` | `"headless"` \| `"smtp"` | | Hotmail/Outlook verification strategy (default `smtp`) |

> **Body-level SMTP fields are only honored when `proxy` is set.** When `proxy` is unset, `hello_name`, `from_email`, `smtp_timeout`, and `smtp_port` from the request body are **ignored** and the server's TOML config is used instead. This matches the original Rust backend's behavior. Set those values via config (or via `EMAIL_CHECKER__*` env vars) when you don't need a proxy.

#### Proxy object

| Field | Type | Required | Description |
|---|---|---|---|
| `host` | string | ✅ | SOCKS5 proxy host |
| `port` | number | ✅ | SOCKS5 proxy port |
| `username` | string | | SOCKS5 user id |
| `password` | string | | SOCKS5 password |
| `timeout_ms` | number | | Proxy-hop timeout (ms). Falls back to the SMTP timeout when omitted |

#### Example

```bash
curl -X POST "$BASE_URL/v1/check_email" \
  -H "Content-Type: application/json" \
  -H "x-api-secret: YOUR_SECRET" \
  -d '{
    "to_email": "someone@gmail.com",
    "check_gravatar": true
  }'
```

#### Response

The response is a single flat object. All check details sit at the top level next to `is_reachable` for easy access — no nested `syntax`, `mx`, `smtp`, `misc`, or `debug` objects.

```json
{
  "input": "someone@gmail.com",
  "is_reachable": "safe",
  "risk_score": 0,

  "email_address": "someone@gmail.com",
  "email_username": "someone",
  "email_domain": "gmail.com",
  "email_domain_unicode": "gmail.com",
  "normalized_email": "someone@gmail.com",
  "is_valid_syntax": true,
  "syntax_suggestion": null,

  "is_disposable_email": false,
  "is_role_account": false,
  "is_b2c_provider": true,
  "gravatar_url": null,
  "has_been_pwned": null,
  "spf_present": true,
  "dmarc_policy": "reject",
  "dkim_selectors_found": ["google"],

  "mx_accepts_mail": true,
  "mx_records": ["gmail-smtp-in.l.google.com"],
  "mx_preferred_host": "gmail-smtp-in.l.google.com",
  "mx_preferred_priority": 5,
  "mx_lookup_error_type": null,
  "mx_lookup_error_message": null,

  "smtp_can_connect": true,
  "smtp_has_full_inbox": false,
  "smtp_is_catch_all": false,
  "smtp_is_deliverable": true,
  "smtp_is_disabled_account": false,
  "smtp_error_type": null,
  "smtp_error_message": null,
  "smtp_error_description": null,

  "backend_name": "backend-dev",
  "check_started_at": "2026-01-01T00:00:00.000Z",
  "check_completed_at": "2026-01-01T00:00:01.200Z",
  "check_duration_ms": 1200,
  "check_duration_seconds": 1,
  "check_duration_nanos": 200000000,
  "verification_method_type": "smtp",
  "verification_method_host": "gmail-smtp-in.l.google.com",
  "verification_method_smtp_port": 25,
  "verification_method_provider": "gmail",
  "verification_method_chosen": "smtp",
  "verification_method_requested": null,
  "verification_method_fallback": null
}
```

#### `is_reachable` values

| Value | Meaning |
|---|---|
| `safe` | Mailbox exists and appears deliverable |
| `risky` | Potentially deliverable but flagged (disposable, role, catch-all, etc.) |
| `invalid` | Address does not exist or domain rejects mail |
| `unknown` | Inconclusive — network timeout, greylisting, or provider restrictions |

#### Response fields

All fields below appear at the top level of the response.

**Top-level**

| Field | Type | Description |
|---|---|---|
| `input` | string | The exact `to_email` value submitted |
| `is_reachable` | `safe` \| `risky` \| `invalid` \| `unknown` | Aggregate verdict (legacy bucket — preserved for backward compatibility) |
| `risk_score` | integer (0–100) | Weighted numeric risk score. `0` = clean / deliverable, `100` = invalid or undeliverable. Higher means more bad signals fired (no MX, role account, disposable, missing SPF/DMARC, etc.). Computed independently from `is_reachable` so existing clients can continue using the bucket while new clients can apply custom thresholds. Rough guidance: `0–20` ≈ safe, `21–50` ≈ risky-leaning, `51–80` ≈ likely undeliverable, `81–100` ≈ invalid. |

**Syntax**

| Field | Type | Description |
|---|---|---|
| `email_address` | string \| null | Trimmed email address (null if syntax invalid). Domain part is ASCII (punycode) form for IDN inputs. |
| `email_username` | string | Local part (before `@`) |
| `email_domain` | string | Domain part (after `@`), ASCII form. For IDN domains the value is the `xn--` punycode form (e.g. `münchen.de` → `xn--mnchen-3ya.de`). |
| `email_domain_unicode` | string | Original unicode form of the domain as submitted, useful for display (e.g. `münchen.de`). Equal to `email_domain` for ASCII-only domains. |
| `normalized_email` | string \| null | Canonical form (e.g. dots stripped for Gmail). Built on the ASCII domain form so it can be used as a stable cache/dedupe key. |
| `is_valid_syntax` | boolean | RFC-compliant syntax check |
| `syntax_suggestion` | string \| null | Suggested correction for likely typos (e.g. `gnail.com` → `gmail.com`) |

**Misc**

| Field | Type | Description |
|---|---|---|
| `is_disposable_email` | boolean | Address belongs to a known disposable / temporary email provider |
| `is_role_account` | boolean | Local part is a role-based address (e.g. `info@`, `admin@`, `support@`) |
| `is_b2c_provider` | boolean | Domain is a consumer mailbox provider (Gmail, Yahoo, Outlook, etc.) |
| `gravatar_url` | string \| null | Gravatar avatar URL when `check_gravatar=true` and one exists |
| `has_been_pwned` | boolean \| null | Whether the address appears in HIBP (only when `haveibeenpwned_api_key` provided) |
| `spf_present` | boolean | Domain publishes a `v=spf1` SPF record at the apex (TXT lookup). |
| `dmarc_policy` | `none` \| `quarantine` \| `reject` \| null | Parsed `p=` tag from the `_dmarc.<domain>` TXT record. `null` means the domain has no DMARC record or the record is malformed. |
| `dkim_selectors_found` | string[] | Common DKIM selectors that responded with a DKIM-flavored TXT record at `<selector>._domainkey.<domain>`. Empty array means none of the probed selectors (`default`, `google`, `selector1`, `selector2`, `k1`, `k2`, `mail`, `dkim`, `s1`, `s2`, `mandrill`, `mxvault`) returned a hit. This is a probabilistic signal — DKIM doesn't publish selector lists, so a domain may use DKIM with a custom selector that we don't probe. |

**MX**

| Field | Type | Description |
|---|---|---|
| `mx_accepts_mail` | boolean | Domain has at least one resolvable MX record |
| `mx_records` | string[] | All discovered MX hostnames (sorted by priority) |
| `mx_preferred_host` | string \| null | Lowest-priority MX hostname used for the SMTP probe |
| `mx_preferred_priority` | number \| null | Priority of the preferred MX |
| `mx_lookup_error_type` | string \| null | DNS error code (`ENODATA`, `ENOTFOUND`, etc.) when lookup failed |
| `mx_lookup_error_message` | string \| null | Human-readable DNS error message |

**SMTP**

| Field | Type | Description |
|---|---|---|
| `smtp_can_connect` | boolean | TCP/SMTP greeting reached the MX server |
| `smtp_has_full_inbox` | boolean | Mailbox is full / over quota |
| `smtp_is_catch_all` | boolean | Domain accepts any local part (catch-all) |
| `smtp_is_deliverable` | boolean | RCPT TO accepted by the MX |
| `smtp_is_disabled_account` | boolean | Mailbox exists but is disabled / suspended |
| `smtp_error_type` | string \| null | Error class (`ConnectionError`, `SmtpError`, etc.) |
| `smtp_error_message` | string \| null | Raw SMTP error message |
| `smtp_error_description` | string \| null | Specific tag (`IpBlacklisted`, `NeedsRDNS`, `Greylisted`) when applicable. `Greylisted` indicates the MX returned a 4xx greylist deferral; in worker mode (async/bulk) the worker waits ~60s and re-probes once before surfacing this. The inline single-check HTTP path returns immediately to keep request latency bounded. |

**Debug / metadata**

| Field | Type | Description |
|---|---|---|
| `backend_name` | string | Identifier of the backend that processed the check |
| `check_started_at` | string (ISO-8601) | When the check began |
| `check_completed_at` | string (ISO-8601) | When the check finished |
| `check_duration_ms` | number | Total wall-clock duration in milliseconds |
| `check_duration_seconds` | number | Whole-second portion of the duration |
| `check_duration_nanos` | number | Nanosecond remainder of the duration |
| `verification_method_type` | `smtp` \| `headless` \| `api` \| `skipped` | Strategy actually used |
| `verification_method_host` | string \| null | Host targeted by the strategy |
| `verification_method_smtp_port` | number \| null | Port used for the SMTP probe |
| `verification_method_provider` | string \| null | Detected provider (`gmail`, `yahoo`, `hotmailb2c`, etc.) |
| `verification_method_chosen` | string \| null | Method actually executed |
| `verification_method_requested` | string \| null | Method the caller asked for (if it differed from the chosen one) |
| `verification_method_fallback` | string \| null | Method we fell back to when the requested one was unavailable |

---

### Single Email Validation (Streaming)

**`GET /v1/check_email/stream`**

Run the same validation pipeline as `POST /v1/check_email`, but stream each pipeline stage back to the client over Server-Sent Events as it completes. Useful for UIs that want to surface progress during long SMTP probes instead of blocking on a single JSON response.

**Query parameters**

| Name | Required | Description |
|---|---|---|
| `email` | ✅ | The address to validate. The endpoint accepts this address only — all other knobs (SMTP port, hello name, proxy, etc.) come from server config. |
| `api_secret` | conditional | Same value as the `x-api-secret` header. Required when the server is configured with a header secret and the request comes from a browser `EventSource` (which cannot send custom headers). |

**Authentication**

Either send `x-api-secret: <secret>` as a header (server-to-server) or pass `api_secret=<secret>` as a query parameter (browser `EventSource`). The same secret is checked.

**Event sequence**

Stages are emitted in the same order as the underlying pipeline. If a stage is short-circuited (invalid syntax → no MX/SMTP; MX failure → no SMTP), only the stages that actually ran are emitted, followed by `done`.

| Event | When | `data:` payload |
|---|---|---|
| `syntax` | Local syntax check completes | `{ is_valid_syntax, domain, username, address }` |
| `mx` | MX resolution finishes (success or DNS error) | `{ accepts_mail, records, preferred, lookupError }` |
| `smtp_connect` | TCP/TLS socket to the preferred MX is open | `{ host, port }` |
| `smtp_rcpt` | The mail server replied to `RCPT TO` | `{ code, message }` |
| `done` | Pipeline finished — full result is attached | The same `CheckEmailResponse` object that `POST /v1/check_email` returns |
| `error` | Unexpected server-side error | `{ message }` |

A `: ping` heartbeat comment is emitted every 15 seconds to keep proxies from idling out the connection.

**Example: cURL**

```bash
curl -N "$BASE_URL/v1/check_email/stream?email=foo@example.com&api_secret=$API_SECRET"
```

`-N` disables curl's output buffering so events appear as they arrive.

**Example: Browser `EventSource`**

```js
const url = new URL("/v1/check_email/stream", window.location.origin);
url.searchParams.set("email", "foo@example.com");
// url.searchParams.set("api_secret", "..."); // only if your server requires it

const es = new EventSource(url);

es.addEventListener("syntax",       (e) => console.log("syntax",       JSON.parse(e.data)));
es.addEventListener("mx",           (e) => console.log("mx",           JSON.parse(e.data)));
es.addEventListener("smtp_connect", (e) => console.log("smtp_connect", JSON.parse(e.data)));
es.addEventListener("smtp_rcpt",    (e) => console.log("smtp_rcpt",    JSON.parse(e.data)));
es.addEventListener("done",         (e) => { console.log("result", JSON.parse(e.data)); es.close(); });
es.addEventListener("error",        (e) => { console.error(e); es.close(); });
```

**Worker mode caveat**

When the deployment is configured with `worker.enable = true`, `POST /v1/check_email` dispatches the check through the AMQP RPC worker. The streaming endpoint always runs the check **inline in the API process** so it can emit progress events directly. This means the streaming endpoint does not consume worker capacity, and rate limiting / storage behavior matches the inline path.

**Rate limiting and storage**

Streamed checks count against the same throttle as `POST /v1/check_email`, and the final result is persisted via the same storage path. A 429 is returned (as JSON, before the stream opens) when the throttle is exhausted.

---

### Bulk Validation (Async)

Bulk endpoints require:

- `worker.enable = true` in config
- Postgres storage configured (`storage.postgres.db_url`)
- RabbitMQ running and reachable

> 📥 **Browser UI:** the same three endpoints below back the drag-and-drop bulk page at [`/bulk.html`](./public/bulk.html) — paste in a CSV, watch verdicts tick up, download a result CSV when the job finishes. Useful for one-off list cleanups without writing a script.

#### Create a bulk job

**`POST /v1/bulk`**

Submit a list of emails for async processing.

| Field | Type | Required | Description |
|---|---|---|---|
| `input` | string[] | ✅ | List of email addresses to validate |
| `webhook` | object | | Per-result webhook. See [Webhook object](#webhook-object) below |

#### Webhook object

The worker POSTs to `webhook.on_each_email.url` for **every** processed address (not once at the end of the job). Headers from `webhook.on_each_email.headers` are merged on top of `content-type: application/json`.

The body is JSON with these keys:

| Key | Type | Description |
|---|---|---|
| `result` | object | The full `CheckEmailResponse` for the address |
| `extra` | any \| null | Opaque value passed through from `on_each_email.extra` |
| `taskId` | string | Stable identifier for this delivery (UUID, reused across retries) |
| `email` | string | The email address that was checked |
| `jobId` | object | The originating job, e.g. `{ "kind": "bulk_v1", "id": 123 }` |

Existing receivers built before this change continue to work — `result` and `extra` retain their original shape. The other keys are additive.

| Field | Type | Required | Description |
|---|---|---|---|
| `on_each_email.url` | string | ✅ | Endpoint that receives the POST |
| `on_each_email.headers` | object | | Extra HTTP headers (e.g. `{ "authorization": "Bearer ..." }`) |
| `on_each_email.extra` | any | | Opaque value forwarded back to the webhook in the body's `extra` field |

#### Delivery guarantees

- **Retries**: 4 attempts total (1 initial + 3 retries). Backoff between attempts is `1s`, `5s`, `30s`. Network errors, HTTP 5xx, and HTTP 429 are retried. HTTP 2xx ends the loop with success. Other 4xx responses are treated as terminal failures.
- **At-least-once**: if the worker process is killed after delivering the webhook but before acking the queue message, RabbitMQ may redeliver and the webhook may fire again. The `taskId` field can be used to dedupe on the receiver side.
- **Terminal failure**: when all 4 attempts fail (or a non-retriable status is returned), a single structured JSON line is emitted to the worker's stdout with `event: "webhook_delivery_failed"`, `endpoint`, `taskId`, `jobId`, `email`, `attempts`, `status`, and `error`.

#### Signature verification

When a webhook secret is configured on the server, every request includes an `X-Webhook-Signature` header containing the HMAC-SHA256 of the raw request body, hex-encoded. Receivers should compute the same digest and compare in constant time:

```js
const crypto = require("node:crypto");

function verify(rawBody, headerValue, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(headerValue || "", "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

If no secret is configured, the header is **not** sent — preserving the pre-change request shape for receivers that don't need verification.

Configure the secret via env or TOML:

```bash
EMAIL_CHECKER__WORKER__WEBHOOK__SECRET=your-shared-secret
```

```toml
[worker.webhook]
secret = "your-shared-secret"
```

```json
{
  "input": ["alice@example.com", "bob@example.com"],
  "webhook": {
    "on_each_email": {
      "url": "https://your-app.example.com/hooks/email-result",
      "headers": { "authorization": "Bearer YOUR_TOKEN" },
      "extra":   { "list_id": "q4-cleanup" }
    }
  }
}
```

Duplicate addresses are deduplicated case-insensitively (after trimming surrounding whitespace) before tasks are dispatched, so each unique address is only checked once. The original input list — including casing, whitespace, and duplicates — is preserved on the job and replayed in the results endpoint, so the output still contains exactly one row per submitted input in submission order.

```bash
curl -X POST "$BASE_URL/v1/bulk" \
  -H "Content-Type: application/json" \
  -H "x-api-secret: YOUR_SECRET" \
  -d '{
    "input": ["Alice@example.com", "alice@example.com", "bob@example.com"]
  }'
```

```json
{
  "job_id": 42,
  "total_inputs": 3,
  "unique_inputs": 2,
  "deduplicated": 1
}
```

| Field | Description |
|---|---|
| `job_id` | Identifier used for polling and result fetching |
| `total_inputs` | Total number of addresses submitted in the request body |
| `unique_inputs` | Number of unique addresses after case-insensitive deduplication; this is the number of SMTP/MX checks the worker actually performs |
| `deduplicated` | `total_inputs - unique_inputs`; how many duplicate rows were collapsed |

#### Poll job progress

**`GET /v1/bulk/:id`**

```bash
curl "$BASE_URL/v1/bulk/42" \
  -H "x-api-secret: YOUR_SECRET"
```

Returns current progress. `total_inputs` is the size of the original submission, `total_records` is the number of unique addresses that the worker checks, and `total_processed` is how many of those unique checks have completed. The job flips to `completed` once `total_processed == total_records`.

```json
{
  "job_id": 42,
  "created_at": "2026-05-08T10:00:00.000Z",
  "finished_at": null,
  "total_inputs": 3,
  "total_records": 2,
  "total_processed": 1,
  "summary": {
    "total_safe": 1,
    "total_risky": 0,
    "total_invalid": 0,
    "total_unknown": 0
  },
  "job_status": "running"
}
```

#### Fetch results

**`GET /v1/bulk/:id/results`**

Query parameters:

| Param | Values | Default | Description |
|---|---|---|---|
| `format` | `json` \| `csv` | `json` | Output format |
| `limit` | number | `50` (JSON), all (CSV) | Max rows to return |
| `offset` | number | `0` | Pagination offset |

```bash
# JSON (paginated)
curl "$BASE_URL/v1/bulk/42/results?format=json&limit=100&offset=0" \
  -H "x-api-secret: YOUR_SECRET"

# CSV (full export)
curl "$BASE_URL/v1/bulk/42/results?format=csv" \
  -H "x-api-secret: YOUR_SECRET" \
  -o results.csv
```

##### CSV columns

The CSV is a flat snapshot of the most useful fields from each result. Column names match the JSON response fields described above (one row per email).

| Column | Type | Source field |
|---|---|---|
| `input` | string | `input` |
| `is_reachable` | string | `is_reachable` |
| `email_address` | string | `email_address` |
| `email_username` | string | `email_username` |
| `email_domain` | string | `email_domain` |
| `is_valid_syntax` | boolean | `is_valid_syntax` |
| `is_disposable_email` | boolean | `is_disposable_email` |
| `is_role_account` | boolean | `is_role_account` |
| `is_b2c_provider` | boolean | `is_b2c_provider` |
| `gravatar_url` | string \| null | `gravatar_url` |
| `mx_accepts_mail` | boolean | `mx_accepts_mail` |
| `mx_preferred_host` | string \| null | `mx_preferred_host` |
| `smtp_can_connect` | boolean | `smtp_can_connect` |
| `smtp_has_full_inbox` | boolean | `smtp_has_full_inbox` |
| `smtp_is_catch_all` | boolean | `smtp_is_catch_all` |
| `smtp_is_deliverable` | boolean | `smtp_is_deliverable` |
| `smtp_is_disabled_account` | boolean | `smtp_is_disabled_account` |
| `error` | string \| null | First non-empty of `smtp_error_message`, `mx_lookup_error_message`, top-level `error` |

For the full per-row schema (DNS lookup details, SMTP error subtypes, debug/timing fields), use `format=json`.

#### List failed tasks (DLQ)

**`GET /v1/bulk/:id/failures`**

Returns the bulk-job tasks that exhausted the worker retry budget and were routed to the dead-letter queue. Useful for diagnosing systematic failures (e.g. a malformed input batch or a misconfigured network) and for re-submitting only the failed inputs without re-running the whole job.

Unlike `/results`, this endpoint can be called while the job is still running.

Query parameters:

| Param | Values | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Max rows to return |
| `offset` | number | `0` | Pagination offset |

```bash
curl "$BASE_URL/v1/bulk/42/failures?limit=100" \
  -H "x-api-secret: YOUR_SECRET"
```

Response:

```json
{
  "job_id": 42,
  "total": 3,
  "failures": [
    {
      "id": 17,
      "payload": {
        "input": { "to_email": "broken@example.com" },
        "job_id": { "kind": "bulk_v1", "id": 42 }
      },
      "error": "SMTP connection refused",
      "attempts": 2,
      "dlq_arrived_at": "2026-05-08T18:42:11.123Z"
    }
  ]
}
```

`attempts` is the total number of times the worker tried the task before dead-lettering it (currently `2` — the original delivery plus one requeue).

---

## Error Responses

All errors return JSON:

```json
{ "error": "human-readable message" }
```

| Status | Meaning |
|---|---|
| `200` | Success |
| `400` | Bad request — missing/invalid field or wrong/missing `x-api-secret` |
| `429` | Rate limited — try again after a short delay |
| `500` | Internal server error |
| `503` | Infrastructure not available (`/ready` failed or worker dependencies unavailable) |

---

## Integration Examples

### JavaScript / TypeScript

```ts
const BASE_URL = process.env.EMAIL_API_BASE_URL!;
const API_SECRET = process.env.EMAIL_API_SECRET!;

async function validateEmail(email: string) {
  const res = await fetch(`${BASE_URL}/v1/check_email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-secret": API_SECRET,
    },
    body: JSON.stringify({ to_email: email }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `HTTP ${res.status}`);
  }

  return res.json();
}

const result = await validateEmail("someone@gmail.com");
console.log(result.is_reachable); // "safe" | "risky" | "invalid" | "unknown"
```

### Python

```python
import os, requests

BASE_URL = os.environ["EMAIL_API_BASE_URL"]
API_SECRET = os.environ["EMAIL_API_SECRET"]

def validate_email(email: str) -> dict:
    resp = requests.post(
        f"{BASE_URL}/v1/check_email",
        json={"to_email": email},
        headers={"x-api-secret": API_SECRET},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()

result = validate_email("someone@gmail.com")
print(result["is_reachable"])
```

### cURL one-liner

```bash
curl -s -X POST "$BASE_URL/v1/check_email" \
  -H "Content-Type: application/json" \
  -H "x-api-secret: $EMAIL_API_SECRET" \
  -d "{\"to_email\":\"$EMAIL\"}" | jq '.is_reachable'
```

---

## Recommended Patterns

### Single email (sign-up validation)

1. Call `POST /v1/check_email`
2. Check `is_reachable`:
   - `safe` → accept
   - `risky` → warn the user or flag for review
   - `invalid` → reject with a clear error
   - `unknown` → accept with a soft warning (network issue on our end)
3. Use `is_disposable_email`, `is_role_account`, `is_b2c_provider`, and the `email_*` / `syntax_suggestion` fields for additional UX logic

### Bulk list cleaning

1. `POST /v1/bulk` → store the returned `job_id`
2. Poll `GET /v1/bulk/:id` until status is complete
3. `GET /v1/bulk/:id/results?format=csv` → download and process

---

## Notes

- Request body limit: **50 MB** (suitable for large bulk payloads submitted directly)
- For production integrations, configure a client-side timeout (recommended: 30–60 s per check) and a retry policy with exponential backoff
- SMTP checks depend on remote server availability; `unknown` results are normal for some providers and do not indicate a bug
