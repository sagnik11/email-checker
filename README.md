# Email Validation Service

[![Autter](https://autter.dev/logo-dark.png)](https://autter.dev)

TypeScript-based email verification backend and CLI.

## Sponsor

This project is sponsored by **[Autter](https://autter.dev)**.

## What It Does

`Email Validation Service` validates email addresses without sending an email by combining:

- syntax validation
- MX DNS checks
- SMTP conversation checks
- account risk signals (disposable / role-based / B2C traits)
- optional Gravatar and HaveIBeenPwned checks

It supports:

- HTTP API (`/v1/check_email`, `/v1/bulk`, bulk status/results routes)
- worker mode (RabbitMQ queue + async processing)
- Postgres persistence for bulk and task outputs
- installable CLI (`email-validator`)
- browser-based quick check page at `/`

## Tech Stack

- Node.js 18+
- TypeScript (CommonJS output)
- Express
- RabbitMQ (`amqplib`)
- Postgres (`pg`)

## Quick Start

```bash
npm install
npm run dev
```

Server starts at `http://127.0.0.1:8080` by default.

### Build + Run Compiled Output

```bash
npm run build
npm start
```

### Tests

```bash
npm test
```

## Configuration

Default config file path:

- `./backend_config.toml`

Default SMTP identity:

- `from_email = noreply@example.com`
- `hello_name = example.com`

Environment overrides use `EMAIL_CHECKER__...` keys:

- `EMAIL_CHECKER__HTTP_HOST=0.0.0.0`
- `EMAIL_CHECKER__HTTP_PORT=8080`
- `EMAIL_CHECKER__HEADER_SECRET=my-secret`
- `EMAIL_CHECKER__WORKER__ENABLE=true`
- `EMAIL_CHECKER__WORKER__RABBITMQ__URL=amqp://guest:guest@localhost:5672`
- `EMAIL_CHECKER__STORAGE__POSTGRES__DB_URL=postgresql://localhost/email_checker_db`

`PORT` is also respected and mapped to `http_port`.

## CLI

Show help:

```bash
email-validator --help
```

Run HTTP server:

```bash
email-validator serve --config ./backend_config.toml
```

Run worker only:

```bash
email-validator worker --config ./backend_config.toml
```

Direct one-off check:

```bash
email-validator check someone@gmail.com
```

## API

### `GET /version`

Returns current package version.

### `POST /v1/check_email`

```bash
curl -X POST http://127.0.0.1:8080/v1/check_email \
  -H 'content-type: application/json' \
  -d '{"to_email":"someone@gmail.com"}'
```

### `POST /v1/bulk`

Requires:

- `worker.enable = true`
- Postgres storage configured
- RabbitMQ configured

```bash
curl -X POST http://127.0.0.1:8080/v1/bulk \
  -H 'content-type: application/json' \
  -d '{"input":["a@example.com","b@example.com"]}'
```

### `GET /v1/bulk/:id`

Gets current job progress.

### `GET /v1/bulk/:id/results?format=json|csv&limit=&offset=`

Fetches final results in JSON or CSV.

## Vercel Deployment

This repository includes:

- `vercel.json`
- `api/index.ts`

for deploying the HTTP API as a serverless function.

### One-Time Setup

1. Push this repo to GitHub/GitLab/Bitbucket.
2. Import the repository in Vercel.
3. Set Node.js runtime to 18+.
4. Add required environment variables in Vercel Project Settings.

### Recommended Vercel Env Vars

- `EMAIL_CHECKER__HEADER_SECRET`
- `EMAIL_CHECKER__HTTP_HOST` (optional)
- `EMAIL_CHECKER__HTTP_PORT` (optional)
- any SMTP/proxy/env overrides you use

### Important Vercel Notes

- Vercel deployment is best for **single-check API usage** (`/v1/check_email`).
- Bulk + queue workflows (`/v1/bulk`) still need long-running worker + RabbitMQ + Postgres setup outside serverless constraints.
- Use separate infrastructure (VM/container) for production worker mode.

## Project Documentation

Detailed architecture and operational guide:

- `PROJECT_WORKING_AND_FEATURES.md`
- `API_DOCUMENTATION.md`
