# Deploying to Fly.io

This guide walks through deploying Email Validator to [Fly.io](https://fly.io) as a persistent, always-on API server.

Fly.io is a great fit for this project because it:

- Runs a real VM (not serverless), so SMTP connections work without restrictions
- Supports persistent machines with a warm minimum count
- Has a generous free tier for small workloads

---

## Prerequisites

- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated (`flyctl auth whoami`)
- A Fly account with billing enabled
- This repository cloned locally

---

## Step 1 — Initialize your Fly app

If you're deploying for the first time, create a new Fly app:

```bash
flyctl launch --no-deploy
```

This creates a `fly.toml` in the repo root and registers the app with Fly. Make note of your app name — you'll use it throughout this guide.

Alternatively, a pre-configured `fly.toml` is already committed with these key settings:

| Setting | Value |
|---|---|
| `internal_port` | `8080` |
| `force_https` | `true` |
| `min_machines_running` | `1` (keeps one machine warm) |
| VM size | `shared-cpu-1x`, 512 MB RAM |

Edit `fly.toml` if you need a different region or machine size.

---

## Step 2 — Set secrets

Set the required environment variables as Fly secrets. Replace `<your-app-name>` and the secret value:

```bash
flyctl secrets set \
  EMAIL_CHECKER__HEADER_SECRET="replace-with-a-strong-random-secret" \
  EMAIL_CHECKER__HTTP_HOST="0.0.0.0" \
  EMAIL_CHECKER__HTTP_PORT="8080" \
  EMAIL_CHECKER__ALLOW_BROWSER_WITHOUT_SECRET="false" \
  --app <your-app-name>
```

Optional SMTP / proxy tuning:

```bash
flyctl secrets set \
  EMAIL_CHECKER__HELLO_NAME="mail.yourdomain.com" \
  EMAIL_CHECKER__FROM_EMAIL="noreply@yourdomain.com" \
  --app <your-app-name>
```

---

## Step 3 — Deploy

```bash
flyctl deploy --app <your-app-name> --remote-only
```

To lock the machine count and memory:

```bash
flyctl scale count 1 --app <your-app-name> --yes
flyctl scale memory 512 --app <your-app-name>
```

---

## Step 4 — Verify

```bash
# Liveness check (process up)
curl -sS https://<your-app-name>.fly.dev/health

# Readiness check (Postgres + RabbitMQ reachable)
curl -sS https://<your-app-name>.fly.dev/ready

# Version
curl -sS https://<your-app-name>.fly.dev/version

# Test a validation (requires your secret)
curl -X POST "https://<your-app-name>.fly.dev/v1/check_email" \
  -H "Content-Type: application/json" \
  -H "x-api-secret: replace-with-a-strong-random-secret" \
  -d '{"to_email":"someone@gmail.com"}'
```

---

## Step 5 — Connect your app

Set these environment variables in any service that calls the Email Validator API:

```env
EMAIL_CHECKER_BASE_URL=https://<your-app-name>.fly.dev
EMAIL_CHECKER_API_SECRET=replace-with-a-strong-random-secret
EMAIL_CHECKER_TIMEOUT_MS=30000
```

Optional extras:

```env
HIBP_API_KEY=your-haveibeenpwned-key
EMAIL_VERIFY_SMTP_PORT=587
```

---

## CI/CD (optional)

This repo includes `.github/workflows/fly-deploy.yml` for automatic deploys on push to `master`.

To enable it:

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add a secret named `FLY_API_TOKEN` (get it from `flyctl auth token`)
3. Push to `master` — the workflow deploys automatically

---

## Bulk + Worker Mode on Fly

For bulk processing you also need RabbitMQ and Postgres. Options:

- **Fly Postgres** — `flyctl postgres create`
- **Upstash / CloudAMQP** — managed RabbitMQ with a free tier
- **Any external DB/queue** — pass connection strings as secrets

Once provisioned, add:

```bash
flyctl secrets set \
  EMAIL_CHECKER__WORKER__ENABLE="true" \
  EMAIL_CHECKER__WORKER__RABBITMQ__URL="amqp://..." \
  EMAIL_CHECKER__STORAGE__POSTGRES__DB_URL="postgresql://..." \
  --app <your-app-name>
```

Then run a separate worker machine or process group.
