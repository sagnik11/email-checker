# Email Validator

<p align="center">
  <strong>Verify email addresses without sending a single email.</strong><br/>
  Deep validation via syntax checks, MX DNS lookups, and live SMTP handshakes — with disposable/role/B2C detection built in.
</p>

<p align="center">
  <a href="https://github.com/sagnik11/email-checker/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js ≥18"></a>
  <img src="https://img.shields.io/badge/built%20with-TypeScript-3178c6.svg" alt="TypeScript">
  <a href="https://github.com/sagnik11/email-checker/issues"><img src="https://img.shields.io/github/issues/sagnik11/email-checker.svg" alt="Open issues"></a>
  <a href="https://ko-fi.com/sagnikghosh1111"><img src="https://img.shields.io/badge/support-Ko--fi-FF5E5B.svg?logo=ko-fi&logoColor=white" alt="Support on Ko-fi"></a>
</p>

<p align="center">
  <a href="https://ko-fi.com/sagnikghosh1111"><img src="https://storage.ko-fi.com/cdn/kofi6.png?v=6" alt="Buy me a coffee on Ko-fi" height="42"></a>
</p>

---

> ### 💡 If this is the kind of problem that gets you excited, you'd love what we're building at **[Autter](https://autter.dev)**
>
> This project was born out of real infrastructure problems we hit while building Autter — deep protocol-level work, reliable tooling, and systems that developers can actually trust. If that sounds like your thing, come take a look: **[autter.dev](https://autter.dev)**

---

## Why use this?

Sending a welcome email to a bad address wastes resources, hurts deliverability, and burns sender reputation. Most validation libraries only check syntax. **Email Validator** goes further:

| Check | What it does |
|---|---|
| **Syntax** | RFC-compliant format validation + typo suggestions, with full IDN/unicode domain support (e.g. `info@münchen.de`) |
| **MX DNS** | Confirms the domain actually accepts mail |
| **SMTP handshake** | Connects directly to the mail server to verify the mailbox exists |
| **Greylist-aware retry** | Detects 4xx greylist deferrals and re-probes after a delay (worker/bulk flow only) |
| **Mail-auth posture** | Surfaces SPF presence, DMARC `p=` policy, and discovered DKIM selectors |
| **Risk score 0–100** | Weighted numeric score alongside the legacy `is_reachable` bucket |
| **Disposable detection** | Flags throwaway domains (10 minute mail, etc.) |
| **Role account detection** | Flags `info@`, `noreply@`, `support@`, etc. |
| **B2C detection** | Identifies consumer providers (Gmail, Outlook, Yahoo, plus 50+ free-mail providers) |
| **Gravatar lookup** | Optional — fetch profile image URL |
| **HaveIBeenPwned** | Optional — check if the address appears in breach data |

Every check returns a structured JSON result with both a coarse `is_reachable` verdict (`safe` / `risky` / `invalid` / `unknown`) and a fine-grained `risk_score` (0–100).

> 📖 **Docs:** browse the live documentation page at [`/docs.html`](./public/docs.html) once the server is running, or read the machine-readable OpenAPI 3.1 spec at [`/openapi.yaml`](./public/openapi.yaml).
>
> 📥 **Bulk UI:** validate a CSV of addresses straight from the browser at [`/bulk.html`](./public/bulk.html) — drag, drop, watch progress, download a verdict CSV.

---

## vs. Paid Alternatives

Most teams reach for ZeroBounce, NeverBounce, or similar SaaS tools by default. Here's an honest comparison:

| | **Email Validator** (this) | ZeroBounce | NeverBounce | Hunter Verifier | Kickbox |
|---|---|---|---|---|---|
| **Cost** | Free / self-hosted | ~$0.008–0.02/check | ~$0.008/check | ~$49/mo (1k checks) | ~$0.01/check |
| **SMTP handshake** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Disposable detection** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Role account detection** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Privacy — emails stay on your server** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **No API keys or third-party dependencies** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Unlimited checks** | ✅ | ❌ credit-based | ❌ credit-based | ❌ quota-based | ❌ credit-based |
| **Bulk async processing** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Self-hostable** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **HaveIBeenPwned check** | ✅ optional | ❌ | ❌ | ❌ | ❌ |
| **Open source** | ✅ AGPL-3.0 | ❌ | ❌ | ❌ | ❌ |

### Why this matters

**Privacy.** Every email address you validate with a SaaS vendor passes through their infrastructure. For B2B sales lists, user signups, or regulated data, that's a real risk. With this tool, addresses never leave your own servers.

**Cost at scale.** Validating 100,000 addresses/month on ZeroBounce or NeverBounce costs $800–$2,000. Self-hosted, it costs the price of a small VPS.

**No vendor lock-in.** SaaS providers change pricing, throttle APIs, or go down. Running your own validator means you control the reliability and economics.

**Customisability.** Need to add a custom blocklist, tweak scoring logic, or integrate directly into your pipeline? You have the source code.

> The tradeoff: self-hosting requires infra setup and maintenance. If you need a zero-ops cloud option, the paid services are convenient. But for teams that care about privacy, cost, and control — this is the better choice.

---

## Features

- **HTTP API** — single check (`POST /v1/check_email`), live progress stream (`GET /v1/check_email/stream`), and async bulk processing (`POST /v1/bulk`)
- **CLI** — `email-validator check someone@gmail.com` from your terminal
- **Web UI** — browser-based quick-check page served at `/`, plus a drag-and-drop bulk page at [`/bulk.html`](./public/bulk.html) for CSV upload, live progress, and CSV download
- **Queue worker** — RabbitMQ-backed async processing for large lists
- **Bulk jobs** — submit thousands of addresses, poll for progress, export JSON or CSV (CSV columns mirror the flat JSON fields)
- **Postgres persistence** — bulk job tracking and result retrieval
- **Rate limiting** — configurable per-second / minute / hour / day throttling
- **SOCKS5 proxy support** — route SMTP connections through a proxy
- **Vercel & Fly.io ready** — deployment configs included
- **Docker ready** — `Dockerfile` and `.dockerignore` included

---

## Quick Start

```bash
# Clone
git clone https://github.com/sagnik11/email-checker.git
cd email-checker

# Install dependencies
npm install

# Start development server
npm run dev
```

The server starts at `http://127.0.0.1:8080`. Open it in your browser to try the web UI, or call the API directly:

```bash
curl -X POST http://127.0.0.1:8080/v1/check_email \
  -H 'content-type: application/json' \
  -d '{"to_email":"someone@gmail.com"}'
```

**Example response:**

The response is a single flat object — `is_reachable` followed by every detail field at the top level. No nested `syntax`, `mx`, `smtp`, `misc`, or `debug` sections.

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

See [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md) for the full field reference.

---

## Installation Options

### Build & run compiled output

```bash
npm run build
npm start
```

### Install CLI globally

```bash
npm install -g .
email-validator --help
email-validator check someone@gmail.com
email-validator serve --config ./backend_config.toml
```

### Docker

```bash
docker build -t email-validator .
docker run -p 8080:8080 email-validator
```

---

## Deployment

| Platform | Guide |
|---|---|
| **Fly.io** | [`FLY_DEPLOYMENT.md`](./FLY_DEPLOYMENT.md) |
| **Vercel** | See below |
| **Docker / VPS** | Use the included `Dockerfile` |

### Deploy to Vercel (serverless, single checks)

1. Push this repo to GitHub.
2. Import into [Vercel](https://vercel.com).
3. Set Node.js runtime to 18+.
4. Add environment variables in Vercel Project Settings.

> **Note:** Bulk + worker mode requires long-running infrastructure (VM/container + RabbitMQ + Postgres). Vercel works best for single-check API usage only.

---

## Configuration

Configuration is loaded from `./backend_config.toml` (or a path you specify). All values can be overridden with environment variables using the `EMAIL_CHECKER__` prefix.

```toml
# backend_config.toml
backend_name = "my-validator"
http_host    = "0.0.0.0"
http_port    = 8080
hello_name   = "example.com"
from_email   = "noreply@example.com"

[throttle]
max_requests_per_second = 20
max_requests_per_minute = 200

[worker]
enable = false

[worker.rabbitmq]
url         = "amqp://guest:guest@localhost:5672"
concurrency = 5

# [storage.postgres]
# db_url = "postgresql://localhost/email_checker_db"
```

### Environment variable overrides

Two naming conventions exist:

- **`EMAIL_CHECKER__<SECTION>__<KEY>`** (double-underscore) — overlays on top of `backend_config.toml`. Use this for everything that has a TOML key.
- **`EMAIL_CHECKER_<KEY>`** (single-underscore) — read directly by the checker; useful on cloud providers that pass env vars through a flat namespace and for cases where the value should win over both TOML and request body.

| Variable | Description |
|---|---|
| `EMAIL_CHECKER__HTTP_HOST` | Bind address (default `127.0.0.1`) |
| `EMAIL_CHECKER__HTTP_PORT` | Port (default `8080`) |
| `EMAIL_CHECKER__HEADER_SECRET` | API secret for `x-api-secret` header |
| `EMAIL_CHECKER__ALLOW_BROWSER_WITHOUT_SECRET` | Skip secret check for same-origin browser requests |
| `EMAIL_CHECKER__CORS__ORIGINS` | Allowed CORS origins (comma-list or JSON array; default `*`) |
| `EMAIL_CHECKER__WORKER__ENABLE` | Enable queue worker mode |
| `EMAIL_CHECKER__WORKER__RABBITMQ__URL` | RabbitMQ connection string |
| `EMAIL_CHECKER__WORKER__RABBITMQ__CONCURRENCY` | Worker prefetch count (default `5`) |
| `EMAIL_CHECKER__SMTP__GREYLIST_RETRY_MS` | Delay before re-probing on a greylist 4xx in worker flow (default `60000`). Inline HTTP requests do not retry regardless. |
| `EMAIL_CHECKER__STORAGE__POSTGRES__DB_URL` | Postgres connection string |
| `PORT` | Alias for `http_port` (Heroku / Fly / Render compatible) |
| `EMAIL_CHECKER_SMTP_PORT` | SMTP probe port. Wins over body-level `smtp_port`. Set to `587` when port 25 is blocked. |
| `EMAIL_CHECKER_HIBP_API_KEY` | Fallback HaveIBeenPwned API key when none is sent in the request body |
| `EMAIL_CHECKER_FROM_EMAIL` | Fallback MAIL FROM address |
| `EMAIL_CHECKER_HELLO_NAME` | Fallback EHLO domain |
| `EMAIL_CHECKER_BACKEND_NAME` | Fallback backend label (appears in the `backend_name` response field) |
| `SMTP_DEBUG` | Set to `true` for verbose JSON-line logging of every SMTP transaction |

---

## CLI Reference

```bash
# One-off check
email-validator check someone@gmail.com

# Start HTTP server
email-validator serve --config ./backend_config.toml

# Start worker only (requires RabbitMQ + Postgres)
email-validator worker --config ./backend_config.toml

# API + inline worker (single process)
email-validator serve --config ./backend_config.toml   # with worker.enable = true

# Show all options
email-validator --help
```

---

## API Reference

Full reference: [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Process liveness check (server is alive) |
| `GET` | `/ready` | Dependency readiness check (Postgres + RabbitMQ) |
| `GET` | `/version` | Package version |
| `GET` | `/metrics` | Prometheus metrics (text v0.0.4) |
| `POST` | `/v1/check_email` | Validate a single email |
| `GET` | `/v1/check_email/stream` | Validate a single email and stream pipeline stages over Server-Sent Events |
| `POST` | `/v1/bulk` | Submit a bulk validation job |
| `GET` | `/v1/bulk/:id` | Poll bulk job progress |
| `GET` | `/v1/bulk/:id/results` | Fetch results (JSON or CSV) |
| `GET` | `/v1/bulk/:id/failures` | List tasks that exhausted retries (DLQ) |

> **Note for upgrading operators:** the `check_email` queue is now declared with a dead-letter exchange (`dlx.email_check`). RabbitMQ's `assertQueue` rejects argument changes on a pre-existing queue, so on first start with this build you must drain and delete the existing `check_email` queue once (or start with a fresh broker). The exchange and DLQ are created automatically on worker startup.

---

## Observability

The service emits structured JSON logs (via [pino](https://github.com/pinojs/pino)) and Prometheus metrics out of the box.

### Logs

Every HTTP request produces one JSON access log line containing `req.id`, `method`, `url`, `statusCode`, `responseTime` (ms), and — for `/v1/check_email` — the resolved `verdict`. Application logs (MX lookups, SMTP exchanges, worker lifecycle) carry a `source` field. Set `LOG_LEVEL=debug` (default `info`) for verbose output.

```bash
LOG_LEVEL=debug npm run dev
```

### Metrics

`GET /metrics` returns Prometheus exposition format. The custom metrics are:

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `check_email_total` | counter | `verdict` (`safe`/`risky`/`invalid`/`unknown`) | Email checks completed |
| `check_email_duration_seconds` | histogram | — | Latency of each check |
| `bulk_job_active` | gauge | — | Bulk-queue tasks currently in flight on this worker |
| `smtp_errors_total` | counter | `reason` (`invalid`/`full_inbox`/`disabled`/`ip_blacklisted`/`needs_rdns`/`other`) | Classified SMTP errors |

Default Node process metrics (`process_cpu_seconds_total`, `nodejs_eventloop_lag_seconds`, GC, heap, etc.) are also exported.

A sample scrape config is provided at [`prometheus.yml`](./prometheus.yml). Drop it into your Prometheus install or merge the `scrape_configs` block.

> **Production note**: `/metrics` is unauthenticated. Expose it only on a private network or behind your existing auth proxy.

---

## Running Tests

```bash
npm test
```

Tests cover syntax validation, SMTP response parsing, reachability scoring, config loading, and throttling behavior.

---

## Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) to get started.

- **Bug reports** → [open an issue](https://github.com/sagnik11/email-checker/issues)
- **Feature requests** → [start a discussion](https://github.com/sagnik11/email-checker/issues)
- **Pull requests** → fork, branch, and open a PR against `master`

---

## Support this project

If this saved you time or money, consider buying me a coffee — it directly funds maintenance, new features, and faster issue triage.

<p align="center">
  <a href="https://ko-fi.com/sagnikghosh1111"><img src="https://storage.ko-fi.com/cdn/kofi6.png?v=6" alt="Support me on Ko-fi" height="48"></a>
</p>

**→ [ko-fi.com/sagnik11](https://ko-fi.com/sagnikghosh1111)**

---

## Built by **[Autter](https://autter.dev)**

This project came out of real problems we ran into while building Autter. We open-sourced it because the community deserves solid, production-grade email tooling without reinventing the wheel every time.

If working on problems like this — deep protocol-level validation, reliable infrastructure, and developer tooling that actually works — sounds like your kind of thing, we'd love to connect.

**→ [autter.dev](https://autter.dev)**

---

## License

This project is dual-licensed:

- **Open source** — [AGPL-3.0](./LICENSE) for open source projects
- **Commercial** — contact us for a commercial license if you want to use this in proprietary software

See [`LICENSE.md`](./LICENSE.md) for full details.

---

<p align="center">
  <a href="https://autter.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://autter.dev/wordmark-light.png">
      <img src="https://autter.dev/logo-light.png" alt="Autter" height="48" />
    </picture>
  </a>
  <br/>
  <sub>Made with ♥ by the team at <a href="https://autter.dev">Autter</a></sub>
</p>
