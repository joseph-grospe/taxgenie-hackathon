# Local Langfuse Setup

Local Langfuse runs with Docker Compose from `backend/langfuse`.

## 1) Bootstrap

```bash
cd backend/langfuse
cp .env.example .env
```

Edit `.env` and replace secrets:

- `NEXTAUTH_SECRET`
- `SALT`
- `LANGFUSE_INIT_PROJECT_PUBLIC_KEY`
- `LANGFUSE_INIT_PROJECT_SECRET_KEY`

## 2) Start Stack

```bash
./scripts/init.sh
```

Or manually:

```bash
docker compose up -d
```

## 3) Access

- Langfuse UI: `http://localhost:3001`
- MinIO console: `http://localhost:9001`

## 4) Connect Worker/Lambda Locally

Set:

```bash
LANGFUSE_ENABLED=true
LANGFUSE_HOST=http://localhost:3001
LANGFUSE_PUBLIC_KEY=<from .env>
LANGFUSE_SECRET_KEY=<from .env>
```

## 5) Stop / Reset

```bash
docker compose down
```

Full reset:

```bash
docker compose down -v
```
