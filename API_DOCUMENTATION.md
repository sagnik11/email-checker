# API Reference

Complete reference for integrating with the Email Validator HTTP API.

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
| `haveibeenpwned_api_key` | string | | Check address against HaveIBeenPwned breach database |
| `proxy` | object | | Route SMTP through a SOCKS5 proxy |
| `hello_name` | string | | Override EHLO domain sent to remote SMTP |
| `from_email` | string | | Override MAIL FROM address |
| `smtp_timeout` | number | | SMTP connection timeout in seconds |
| `smtp_port` | number | | SMTP port (default: `25`) |
| `yahoo_verif_method` | `"api"` \| `"headless"` \| `"smtp"` | | Yahoo verification strategy |
| `hotmailb2c_verif_method` | `"headless"` \| `"smtp"` | | Hotmail/Outlook verification strategy |

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

```json
{
  "input": "someone@gmail.com",
  "is_reachable": "safe",
  "misc": {
    "is_disposable": false,
    "is_role_account": false,
    "is_b2c": true,
    "gravatar_url": null,
    "haveibeenpwned": null
  },
  "mx": {
    "accepts_mail": true,
    "records": []
  },
  "smtp": {},
  "syntax": {
    "is_valid_syntax": true,
    "username": "someone",
    "domain": "gmail.com"
  },
  "debug": {
    "backend_name": "backend-dev",
    "start_time": "2026-01-01T00:00:00.000Z",
    "end_time": "2026-01-01T00:00:01.200Z",
    "duration": "1200ms"
  }
}
```

#### `is_reachable` values

| Value | Meaning |
|---|---|
| `safe` | Mailbox exists and appears deliverable |
| `risky` | Potentially deliverable but flagged (disposable, role, catch-all, etc.) |
| `invalid` | Address does not exist or domain rejects mail |
| `unknown` | Inconclusive — network timeout, greylisting, or provider restrictions |

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
| `webhook` | string | | URL to POST results to when the job finishes |

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
3. Use `misc.is_disposable`, `misc.is_role_account`, and `syntax` for additional UX logic

### Bulk list cleaning

1. `POST /v1/bulk` → store the returned `job_id`
2. Poll `GET /v1/bulk/:id` until status is complete
3. `GET /v1/bulk/:id/results?format=csv` → download and process

---

## Notes

- Request body limit: **50 MB** (suitable for large bulk payloads submitted directly)
- For production integrations, configure a client-side timeout (recommended: 30–60 s per check) and a retry policy with exponential backoff
- SMTP checks depend on remote server availability; `unknown` results are normal for some providers and do not indicate a bug
