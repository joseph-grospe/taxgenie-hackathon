# Local Backend Development Guide

This project supports two local development modes.

## Choose a Mode

- Mode A: `local app code + AWS dev infra`
  - Uses AWS RDS + AWS SQS + AWS API Gateway/Lambda
  - Good for integration-realistic testing
- Mode B: `local app code + local Postgres/ElectricSQL + AWS SQS`
  - Uses local Docker for Postgres and ElectricSQL
  - Uses AWS SQS for queue behavior
  - Good for fast backend iteration without provisioning RDS/ElectricSQL

## Shared Prerequisites

- Node.js 22+
- pnpm 10+
- Docker
- AWS CLI v2
- Pulumi access through SST

## 0) One-Time AWS + SST Setup

### 0.1 Configure AWS profile

Use a named profile for local backend work:

```bash
aws configure --profile mac-bacon-profile
```

The command prompts for:

- Access key ID
- Secret access key
- Default region (`ap-southeast-1`)
- Output format (for example, `json`)

### 0.2 Login and verify access

```bash
aws sts get-caller-identity --profile mac-bacon-profile
```

### 0.3 Set shell defaults for SST commands

```bash
export AWS_PROFILE=mac-bacon-profile
export AWS_REGION=ap-southeast-1
```

## 1) Install Dependencies

Run all commands below from the repository root:

```bash
cd /path/to/extract-bir-2307
```

```bash
pnpm install
```

## 2) Start Local Langfuse (recommended for both modes)

```bash
cd backend/langfuse
cp .env.example .env
./scripts/init.sh
```

Set these later in `.env.local.backend`:

- `LANGFUSE_HOST=http://localhost:3001`
- `LANGFUSE_PUBLIC_KEY=<your local key>`
- `LANGFUSE_SECRET_KEY=<your local key>`

## Mode A: Local Code + AWS Dev Infra

### A1) Set Infra Bootstrap Variables

```bash
export TAXTRACK_DB_PASSWORD='replace-me'
export TAXTRACK_WEBHOOK_SECRET='replace-me'
export TAXTRACK_WORKER_ADMIN_TOKEN='replace-me'
export TAXTRACK_LANGFUSE_PUBLIC_KEY='replace-me'
export TAXTRACK_LANGFUSE_SECRET_KEY='replace-me'
export TAXTRACK_LANGFUSE_SALT='replace-me'
export TAXTRACK_LANGFUSE_HOST='http://localhost:3001'

# Required image URIs
export TAXTRACK_WORKER_IMAGE_URI='<your-worker-image-uri>'
export TAXTRACK_ELECTRICSQL_IMAGE_URI='<your-electricsql-image-uri>'
```

### A2) Deploy AWS Dev Infra

```bash
pnpm build:lambda
AWS_PROFILE=$AWS_PROFILE pnpm sst:deploy:dev
```

Collect outputs:

- `queueUrl`
- `dlqUrl`
- `dbAddress`
- `dbName`
- `artifactsBucket`
- `webhookUrl`

### A3) Create `.env.local.backend`

```bash
cp .env.backend.example .env.local.backend
```

Fill with Mode A values:

```bash
AWS_REGION=ap-southeast-1
DATABASE_URL=postgresql://taxtrack:<TAXTRACK_DB_PASSWORD>@<dbAddress>:5432/<dbName>
SQS_QUEUE_URL=<queueUrl>
SQS_DLQ_URL=<dlqUrl>
S3_BUCKET=<artifactsBucket>
WEBHOOK_URL=<webhookUrl>
DRIVE_WEBHOOK_SECRET=<TAXTRACK_WEBHOOK_SECRET>
ADMIN_TOKEN=<TAXTRACK_WORKER_ADMIN_TOKEN>
LANGFUSE_ENABLED=true
LANGFUSE_HOST=http://localhost:3001
LANGFUSE_PUBLIC_KEY=<local-langfuse-public-key>
LANGFUSE_SECRET_KEY=<local-langfuse-secret-key>
```

## Mode B: Local Postgres + ElectricSQL + AWS SQS

### B1) Start Local Data Plane

```bash
cd backend/local
cp .env.example .env
./scripts/up.sh
```

This starts:

- Postgres: `localhost:5432`
- ElectricSQL: `localhost:5133`

### B2) Ensure AWS SQS Exists

You still need an SQS queue URL. Use either:

1. Existing dev queue from previous SST deploy, or
2. Deploy minimal dev infra (SQS + webhook API/Lambda only) and reuse outputs:

```bash
pnpm build:lambda
AWS_PROFILE=$AWS_PROFILE pnpm sst:deploy:dev:minimal
```

If you need the full infra stack (VPC, RDS, EC2 worker, ElectricSQL, Langfuse), use:

```bash
AWS_PROFILE=$AWS_PROFILE pnpm sst:deploy:dev
```

### B3) Create `.env.local.backend`

```bash
cp .env.backend.example .env.local.backend
```

Fill with Mode B values:

```bash
AWS_REGION=ap-southeast-1
DATABASE_URL=postgresql://taxtrack:taxtrack@localhost:5432/taxtrack
ELECTRICSQL_URL=http://localhost:5133
SQS_QUEUE_URL=<queueUrl>
SQS_DLQ_URL=<dlqUrl>
S3_BUCKET=<s3-bucket-or-local-test-bucket>
WEBHOOK_URL=<local-sst-webhook-url-or-deployed-webhook-url>
DRIVE_WEBHOOK_SECRET=<your-secret>
ADMIN_TOKEN=<your-admin-token>
LANGFUSE_ENABLED=true
LANGFUSE_HOST=http://localhost:3001
LANGFUSE_PUBLIC_KEY=<local-langfuse-public-key>
LANGFUSE_SECRET_KEY=<local-langfuse-secret-key>
```

## 3) Run Local Services (both modes)

Terminal A (lambda live mode):

```bash
AWS_PROFILE=$AWS_PROFILE pnpm sst:dev
```

Terminal B (worker):

```bash
set -a
source .env.local.backend
set +a
pnpm --filter @taxtrack/worker dev
```

## 4) Trigger Webhook Fixture

```bash
curl -X POST "$WEBHOOK_URL/webhooks/google-drive" \
  -H "content-type: application/json" \
  -H "x-taxtrack-webhook-secret: $DRIVE_WEBHOOK_SECRET" \
  -H "x-goog-channel-id: channel-dev" \
  -H "x-goog-resource-id: resource-dev" \
  -H "x-goog-resource-state: update" \
  -d '{
    "nextPageToken":"token-2",
    "changes":[
      {
        "sourceFileId":"drive-file-123",
        "revision":"2",
        "modifiedTime":"2026-02-17T08:30:00.000Z",
        "mimeType":"application/pdf",
        "artifactUri":"s3://taxtrack-raw/drive-file-123.pdf"
      }
    ]
  }'
```

## 5) Verify Flow

- Lambda log shows enqueue success.
- SQS queue depth increases then decreases.
- Worker logs show job success.
- `worker_jobs` and `document_results` are written in Postgres.
- Result artifact object exists in S3.
- Langfuse trace is visible.

## 6) Stop Local Infra (Mode B)

```bash
cd backend/local
./scripts/down.sh
```

## Troubleshooting

- `401 invalid webhook secret`: ensure request header matches env secret.
- Missing queue URL: run `pnpm sst:deploy:dev:minimal` and use `queueUrl` output.
- AWS auth errors: verify `AWS_PROFILE`, run `aws sts get-caller-identity`, and reconfigure credentials using `aws configure --profile mac-bacon-profile` if needed.
- Worker cannot connect DB in Mode B: ensure `backend/local` stack is up and `DATABASE_URL` is local.
- Worker cannot connect DB in Mode A: verify RDS SG rules and URL.
- No traces: verify `LANGFUSE_*` env values.
- `Bind for 0.0.0.0:9000 failed`: another service is already using host port `9000` (often MinIO). In this repo, ClickHouse is mapped to host `9002` and MinIO remains on `9000`; run `cd backend/langfuse && docker compose down && docker compose up -d`.
- `Bind for 0.0.0.0:3000 failed`: host port `3000` is occupied (often frontend dev server). Langfuse in this repo uses `http://localhost:3001`; run `cd backend/langfuse && docker compose down && docker compose up -d`.
