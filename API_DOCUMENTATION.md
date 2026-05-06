# API Documentation (External Integrations)

This guide explains how an external application can integrate with the Email Validation Service API.

## 1) Base URL

Use your deployed API base URL, for example:

- Local: `http://127.0.0.1:8080`
- Production: `https://your-domain.com`

All examples below assume:

```text
BASE_URL=http://127.0.0.1:8080
```

## 2) Authentication

If `header_secret` is configured on the server, every protected endpoint must include:

```http
x-api-secret: <your-secret>
```

If this header is missing or invalid, API returns `400`.

## 3) Content Type

Send JSON payloads with:

```http
content-type: application/json
```

## 4) Endpoints

### 4.1 Health Check

**GET** `/health`

Use this endpoint to verify service availability.

Response:

```json
{ "ok": true }
```

### 4.2 Version

**GET** `/version`

Response:

```json
{ "version": "0.2.0" }
```

### 4.3 Single Email Validation

**POST** `/v1/check_email`

#### Required field

- `to_email` (string)

#### Optional fields

- `check_gravatar` (boolean)
- `haveibeenpwned_api_key` (string)
- `proxy` (object)
- `hello_name` (string)
- `from_email` (string)
- `smtp_timeout` (number, seconds)
- `smtp_port` (number)
- `yahoo_verif_method` (`api` | `headless` | `smtp`)
- `hotmailb2c_verif_method` (`headless` | `smtp`)

Example request:

```bash
curl -X POST "$BASE_URL/v1/check_email" \
  -H "content-type: application/json" \
  -H "x-api-secret: YOUR_SECRET" \
  -d '{
    "to_email": "someone@gmail.com",
    "check_gravatar": true
  }'
```

Example response (shape):

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
    "end_time": "2026-01-01T00:00:00.000Z",
    "duration": "0ms"
  }
}
```

`is_reachable` possible values:

- `safe`
- `risky`
- `invalid`
- `unknown`

### 4.4 Bulk Validation (Async)

Bulk endpoints require all of the following:

- `worker.enable = true`
- Postgres storage configured
- RabbitMQ configured and available

#### Create bulk job

**POST** `/v1/bulk`

Request body:

- `input` (string[]) required
- `webhook` (string, optional)

Example:

```bash
curl -X POST "$BASE_URL/v1/bulk" \
  -H "content-type: application/json" \
  -H "x-api-secret: YOUR_SECRET" \
  -d '{
    "input": ["a@example.com", "b@example.com"]
  }'
```

Response:

```json
{ "job_id": 123 }
```

#### Check bulk progress

**GET** `/v1/bulk/:id`

Example:

```bash
curl "$BASE_URL/v1/bulk/123" -H "x-api-secret: YOUR_SECRET"
```

#### Get bulk results

**GET** `/v1/bulk/:id/results?format=json|csv&limit=<n>&offset=<n>`

Notes:

- For `format=json`, default page size is `50` when `limit` is not supplied.
- For `format=csv`, all rows are returned unless `limit` is provided.

JSON example:

```bash
curl "$BASE_URL/v1/bulk/123/results?format=json&limit=100&offset=0" \
  -H "x-api-secret: YOUR_SECRET"
```

CSV example:

```bash
curl "$BASE_URL/v1/bulk/123/results?format=csv" \
  -H "x-api-secret: YOUR_SECRET"
```

## 5) Error Handling

Typical error response:

```json
{ "error": "message" }
```

Common status codes:

- `200` success
- `400` bad request / missing header / invalid input
- `429` throttled
- `500` internal server error
- `503` worker or infrastructure requirements not met

## 6) Recommended External App Flow

### Single email

1. Call `POST /v1/check_email`
2. Read `is_reachable`
3. Use `misc`, `smtp`, and `syntax` for UX or risk policy decisions

### Bulk

1. Call `POST /v1/bulk`
2. Store `job_id`
3. Poll `GET /v1/bulk/:id`
4. Fetch final output from `GET /v1/bulk/:id/results`

## 7) JavaScript Integration Example

```js
const BASE_URL = process.env.EMAIL_API_BASE_URL;
const API_SECRET = process.env.EMAIL_API_SECRET;

async function validateEmail(toEmail) {
  const res = await fetch(`${BASE_URL}/v1/check_email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-secret": API_SECRET,
    },
    body: JSON.stringify({ to_email: toEmail }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }

  return res.json();
}
```

## 8) Important Integration Notes

- The API accepts large JSON payloads (up to 50MB request body limit).
- If you send SMTP overrides (`hello_name`, `from_email`, etc.) without a `proxy` object, server-side mapping may fall back to config defaults.
- For production integrations, set a request timeout and retry policy in your client.
