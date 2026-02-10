# wq-email-checker-node

Node.js migration of the Rust backend and checker.

## Included features

- HTTP API endpoints:
  - `GET /version`
  - `POST /v0/check_email`
  - `POST /v1/check_email`
  - `POST /v0/bulk`
  - `GET /v0/bulk/:id`
  - `GET /v0/bulk/:id/results`
  - `POST /v1/bulk`
  - `GET /v1/bulk/:id`
  - `GET /v1/bulk/:id/results`
- Worker queue flow with RabbitMQ for `v1` and bulk tasks
- Postgres storage for persisted task results and bulk progress/results
- Throttle manager for `v1` routes and worker capacity control
- Web UI at `/` for quick single-email checks
- Installable CLI commands

## Install

```bash
cd nodejs
npm install
```

Global install:

```bash
npm install -g .
```

## Configuration

Default config file path is `./backend_config.toml` (inside `nodejs/`).

You can override via env vars using Rust-compatible style:

- `WQ__HTTP_HOST=0.0.0.0`
- `WQ__HTTP_PORT=8080`
- `WQ__HEADER_SECRET=my-secret`
- `WQ__WORKER__ENABLE=true`
- `WQ__WORKER__RABBITMQ__URL=amqp://guest:guest@localhost:5672`
- `WQ__STORAGE__POSTGRES__DB_URL=postgresql://localhost/wq_email_checker_db`

## CLI

Show help:

```bash
wq-email-checker --help
```

### Run API server

```bash
wq-email-checker serve --config ./backend_config.toml
```

### Run worker only

```bash
wq-email-checker worker --config ./backend_config.toml
```

### Direct one-off check

```bash
wq-email-checker check someone@gmail.com
```

## API usage

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

## Development

Run tests:

```bash
npm test
```
