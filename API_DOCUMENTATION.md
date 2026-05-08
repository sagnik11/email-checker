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

Returns `200` when the service is running.

```bash
curl "$BASE_URL/health"
```

```json
{ "ok": true }
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

  "email_address": "someone@gmail.com",
  "email_username": "someone",
  "email_domain": "gmail.com",
  "normalized_email": "someone@gmail.com",
  "is_valid_syntax": true,
  "syntax_suggestion": null,

  "is_disposable_email": false,
  "is_role_account": false,
  "is_b2c_provider": true,
  "gravatar_url": null,
  "has_been_pwned": null,

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
| `is_reachable` | `safe` \| `risky` \| `invalid` \| `unknown` | Aggregate verdict |

**Syntax**

| Field | Type | Description |
|---|---|---|
| `email_address` | string \| null | Trimmed email address (null if syntax invalid) |
| `email_username` | string | Local part (before `@`) |
| `email_domain` | string | Domain part (after `@`) |
| `normalized_email` | string \| null | Canonical form (e.g. dots stripped for Gmail) |
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
| `smtp_error_description` | string \| null | Specific tag (`IpBlacklisted`, `NeedsRDNS`) when applicable |

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

### Bulk Validation (Async)

Bulk endpoints require:

- `worker.enable = true` in config
- Postgres storage configured (`storage.postgres.db_url`)
- RabbitMQ running and reachable

#### Create a bulk job

**`POST /v1/bulk`**

Submit a list of emails for async processing.

| Field | Type | Required | Description |
|---|---|---|---|
| `input` | string[] | ✅ | List of email addresses to validate |
| `webhook` | object | | Per-result webhook. See [Webhook object](#webhook-object) below |

#### Webhook object

The worker POSTs `{ "result": <CheckEmailResponse>, "extra": <any | null> }` to `webhook.on_each_email.url` for **every** processed address (not once at the end of the job). Headers from `webhook.on_each_email.headers` are merged on top of `content-type: application/json`.

| Field | Type | Required | Description |
|---|---|---|---|
| `on_each_email.url` | string | ✅ | Endpoint that receives the POST |
| `on_each_email.headers` | object | | Extra HTTP headers (e.g. `{ "authorization": "Bearer ..." }`) |
| `on_each_email.extra` | any | | Opaque value forwarded back to the webhook in the body's `extra` field |

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

```bash
curl -X POST "$BASE_URL/v1/bulk" \
  -H "Content-Type: application/json" \
  -H "x-api-secret: YOUR_SECRET" \
  -d '{
    "input": ["alice@example.com", "bob@example.com", "invalid@nodomain.xyz"]
  }'
```

```json
{ "job_id": 42 }
```

#### Poll job progress

**`GET /v1/bulk/:id`**

```bash
curl "$BASE_URL/v1/bulk/42" \
  -H "x-api-secret: YOUR_SECRET"
```

Returns current progress (total, processed, failed counts and status).

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
| `503` | Infrastructure not available (worker/RabbitMQ/Postgres not configured) |

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
