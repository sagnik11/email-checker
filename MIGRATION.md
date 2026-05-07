# Migration Guide

This document covers breaking changes and upgrade steps between major versions.

---

## Migrating from the Rust version

If you were running the original Rust-based `check-if-email-exists` binary, this section maps every feature to its equivalent in the current TypeScript implementation.

### What was migrated

| Rust feature | TypeScript equivalent |
|---|---|
| Core checker pipeline | `src/checker/` — syntax, MX, misc, SMTP, scoring |
| HTTP API (`v1` endpoints) | `src/http/` — Express route handlers |
| Queue worker (RabbitMQ) | `src/worker/` — consumer loop + task execution |
| Postgres persistence | `src/storage/postgres.ts` |
| CLI binary | `bin/email-validator.ts` |
| Web UI | `public/index.html` |
| Data files (`roles.txt`, `b2c.txt`, `rules.json`) | `src/data/` |

### API compatibility

All `v1` API endpoints are preserved with the same request/response shape:

- `POST /v1/check_email` — identical fields; `is_reachable` values unchanged
- `POST /v1/bulk` — same request/response structure
- `GET /v1/bulk/:id` — same progress shape
- `GET /v1/bulk/:id/results` — same JSON and CSV output

### Configuration

Environment variable names are unchanged (`EMAIL_CHECKER__...`). The `backend_config.toml` format is the same.

### Provider-specific verification methods

The Rust version supported `yahoo_verif_method` and `hotmailb2c_verif_method` with `api` and `headless` options. The TypeScript version:

- Accepts and parses these fields for API compatibility
- Currently falls back to SMTP for all providers (no browser automation dependency)
- The `smtp` option behaves identically to the Rust implementation

---

## v0.1 → v0.2

### SMTP port configuration

The `smtp_port` field can now be specified per-request in `POST /v1/check_email`. Previously this was only configurable globally.

### CORS support

A `cors.origins` config key was added. Default remains `*`. Set it to restrict cross-origin access:

```env
EMAIL_CHECKER__CORS__ORIGINS=https://yourapp.com
```

### Browser bypass for API secret

New optional flag to let same-origin browser requests skip the `x-api-secret` check:

```env
EMAIL_CHECKER__ALLOW_BROWSER_WITHOUT_SECRET=true
```

### Fly.io deployment

`fly.toml` and `.github/workflows/fly-deploy.yml` added. See [`FLY_DEPLOYMENT.md`](./FLY_DEPLOYMENT.md) for the full guide.
