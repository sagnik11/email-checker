# Email Validator

<p align="center">
  <strong>Verify email addresses without sending a single email.</strong><br/>
  Deep validation via syntax checks, MX DNS lookups, and live SMTP handshakes — with disposable/role/B2C detection built in.
</p>

<p align="center">
  <a href="https://github.com/sagnik11/check-if-email-exists-master/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js ≥18"></a>
  <img src="https://img.shields.io/badge/built%20with-TypeScript-3178c6.svg" alt="TypeScript">
  <a href="https://github.com/sagnik11/check-if-email-exists-master/issues"><img src="https://img.shields.io/github/issues/sagnik11/check-if-email-exists-master.svg" alt="Open issues"></a>
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
| **Syntax** | RFC-compliant format validation + typo suggestions |
| **MX DNS** | Confirms the domain actually accepts mail |
| **SMTP handshake** | Connects directly to the mail server to verify the mailbox exists |
| **Disposable detection** | Flags throwaway domains (10 minute mail, etc.) |
| **Role account detection** | Flags `info@`, `noreply@`, `support@`, etc. |
| **B2C detection** | Identifies consumer providers (Gmail, Outlook, Yahoo) |
| **Gravatar lookup** | Optional — fetch profile image URL |
| **HaveIBeenPwned** | Optional — check if the address appears in breach data |

Every check returns a structured JSON result and a single `is_reachable` verdict: `safe`, `risky`, `invalid`, or `unknown`.

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

- **HTTP API** — single check (`POST /v1/check_email`) and async bulk processing (`POST /v1/bulk`)
- **CLI** — `email-validator check someone@gmail.com` from your terminal
- **Web UI** — browser-based quick-check page served at `/`
- **Queue worker** — RabbitMQ-backed async processing for large lists
- **Bulk jobs** — submit thousands of addresses, poll for progress, export JSON or CSV
- **Postgres persistence** — bulk job tracking and result retrieval
- **Rate limiting** — configurable per-second / minute / hour / day throttling
- **SOCKS5 proxy support** — route SMTP connections through a proxy
- **Vercel & Fly.io ready** — deployment configs included
- **Docker ready** — `Dockerfile` and `.dockerignore` included

---

## Quick Start

```bash
# Clone
git clone https://github.com/sagnik11/check-if-email-exists-master.git
cd check-if-email-exists-master

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

```json
{
  "input": "someone@gmail.com",
  "is_reachable": "safe",
  "misc": {
    "is_disposable": false,
    "is_role_account": false,
    "is_b2c": true,
    "gravatar_url": null
  },
  "mx": { "accepts_mail": true, "records": [] },
  "smtp": {},
  "syntax": {
    "is_valid_syntax": true,
    "username": "someone",
    "domain": "gmail.com"
  }
}
```

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

| Variable | Description |
|---|---|
| `EMAIL_CHECKER__HTTP_HOST` | Bind address (default `127.0.0.1`) |
| `EMAIL_CHECKER__HTTP_PORT` | Port (default `8080`) |
| `EMAIL_CHECKER__HEADER_SECRET` | API secret for `x-api-secret` header |
| `EMAIL_CHECKER__ALLOW_BROWSER_WITHOUT_SECRET` | Skip secret check for same-origin browser requests |
| `EMAIL_CHECKER__WORKER__ENABLE` | Enable queue worker mode |
| `EMAIL_CHECKER__WORKER__RABBITMQ__URL` | RabbitMQ connection string |
| `EMAIL_CHECKER__STORAGE__POSTGRES__DB_URL` | Postgres connection string |
| `PORT` | Alias for `http_port` (Heroku / Fly / Render compatible) |

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
| `GET` | `/health` | Service health check |
| `GET` | `/version` | Package version |
| `POST` | `/v1/check_email` | Validate a single email |
| `POST` | `/v1/bulk` | Submit a bulk validation job |
| `GET` | `/v1/bulk/:id` | Poll bulk job progress |
| `GET` | `/v1/bulk/:id/results` | Fetch results (JSON or CSV) |

---

## Running Tests

```bash
npm test
```

Tests cover syntax validation, SMTP response parsing, reachability scoring, config loading, and throttling behavior.

---

## Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) to get started.

- **Bug reports** → [open an issue](https://github.com/sagnik11/check-if-email-exists-master/issues)
- **Feature requests** → [start a discussion](https://github.com/sagnik11/check-if-email-exists-master/issues)
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
