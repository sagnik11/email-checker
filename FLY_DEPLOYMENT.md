# Fly.io Deployment Guide

This guide deploys the Email Validation Service API to Fly.io.

The app has already been initialized on Fly as:

- App name: `email-checker-autter`
- Public URL: `https://email-checker-autter.fly.dev`

## Prerequisites

- Fly CLI installed and authenticated (`flyctl auth whoami`)
- A Fly organization with billing enabled
- This repository checked out locally

## 1) Review Fly config

`fly.toml` is committed at the repo root.

Current key settings:

- `internal_port = 8080`
- `force_https = true`
- `min_machines_running = 1` (keeps one machine warm)
- single machine target: `count = 1`
- VM size target: `shared-cpu-1x` with `512 MB` RAM

No Fly Postgres is required for this API-only deployment.

## 2) Set required secrets

Set a header secret to protect API routes:

```bash
flyctl secrets set \
  EMAIL_CHECKER__HEADER_SECRET="replace-with-strong-secret" \
  EMAIL_CHECKER__HTTP_HOST="0.0.0.0" \
  EMAIL_CHECKER__HTTP_PORT="8080" \
  EMAIL_CHECKER__ALLOW_BROWSER_WITHOUT_SECRET="false" \
  --app email-checker-autter
```

Optional SMTP/checker tuning secrets can be added the same way.

## 3) Deploy

```bash
flyctl deploy --app email-checker-autter --remote-only
```

## 3.1) Enforce single 512MB machine

```bash
flyctl scale count 1 --app email-checker-autter --yes
flyctl scale memory 512 --app email-checker-autter
```

## 4) Verify health

```bash
curl -sS https://email-checker-autter.fly.dev/health
curl -sS https://email-checker-autter.fly.dev/version
```

If `EMAIL_CHECKER__HEADER_SECRET` is set, test protected endpoint:

```bash
curl -X POST "https://email-checker-autter.fly.dev/v1/check_email" \
  -H "content-type: application/json" \
  -H "x-api-secret: replace-with-strong-secret" \
  -d '{"to_email":"someone@gmail.com"}'
```

## 5) Integrate with hedwig-mail

In `web` and `worker` env vars of `mail-sending-app`, set:

```env
EMAIL_CHECKER_BASE_URL=https://email-checker-autter.fly.dev
EMAIL_CHECKER_API_SECRET=replace-with-strong-secret
EMAIL_CHECKER_TIMEOUT_MS=30000
```

Optional:

```env
HIBP_API_KEY=...
EMAIL_VERIFY_SMTP_PORT=587
```

## 6) Optional CI/CD

This repo includes `.github/workflows/fly-deploy.yml`.

To enable automatic deploy on push:

1. Add `FLY_API_TOKEN` in GitHub repo secrets.
2. Push to `master` (or `main`).

