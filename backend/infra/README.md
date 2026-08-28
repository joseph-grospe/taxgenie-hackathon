# Backend Infra Configuration

SST/Pulumi stack reads values from environment variables first, then from Pulumi config (`taxgenie:*`).

## Required Variables

- `TAXGENIE_DB_PASSWORD`
- `TAXGENIE_WORKER_ADMIN_TOKEN`
- `TAXGENIE_WORKER_IMAGE_URI` (`pnpm deploy:worker` writes the latest built image URI back to the local env file)
- `TAXGENIE_MERGE_WORKER_IMAGE_URI` (`pnpm deploy:merge-worker` writes the latest built image URI back to the local env file)
- `TAXGENIE_LANGSMITH_API_KEY` (workspace-scoped LangSmith service key)
- `GEMINI_API_KEY` (or Pulumi secret `taxgenie:geminiApiKey`)

## Optional Variables

- `WORKER_ECR_REPOSITORY` (used by the local `pnpm deploy:worker` publish-and-deploy command)
- `MERGE_WORKER_ECR_REPOSITORY` (used by the local `pnpm deploy:merge-worker` publish-and-deploy command)
- `TAXGENIE_WORKER_IMAGE_SOURCE_HASH` and `TAXGENIE_MERGE_WORKER_IMAGE_SOURCE_HASH` are maintained by deploy scripts to skip unchanged Docker image builds.
- `TAXGENIE_WORKER_IMAGE_FORCE=1` and `TAXGENIE_MERGE_WORKER_IMAGE_FORCE=1` bypass image hash reuse for one deploy.
- `TAXGENIE_WORKER_COUNT` accepts only `1` or `2`. Dev defaults to `1`; UAT and `uat-*` stages default to `2`.
- `TAXGENIE_DB_TUNNEL_INSTANCE_ID` (used by `pnpm db:tunnel`; set to the deployed `workerInstanceId` output or another SSM-enabled EC2 instance that can reach RDS)
- `TAXGENIE_DB_TUNNEL_HOST` (used by `pnpm db:tunnel`; set to the deployed `dbHost` output when `DATABASE_URL` is not available locally)
- `TAXGENIE_DB_TUNNEL_LOCAL_PORT` and `TAXGENIE_DB_TUNNEL_REMOTE_PORT` (optional tunnel port overrides; defaults are `15432` and `5432`)
- `TAXGENIE_LANGSMITH_ENDPOINT` (defaults to `https://apac.api.smith.langchain.com`)
- `TAXGENIE_LANGSMITH_PROJECT` (defaults to `taxgenie-${SST_STAGE}`)
- `TAXGENIE_LOCAL_DATABASE_URL` (used by `sst dev` Postgres local mode; defaults to `postgresql://taxgenie:taxgenie@localhost:5432/taxgenie`)
- `TAXGENIE_AZ_PRIMARY` (defaults to `${AWS_REGION}a`)
- `TAXGENIE_AZ_SECONDARY` (defaults to `${AWS_REGION}b`)
- `TAXGENIE_WEB_DOMAIN` (overrides the stage default: `dev.taxgenie.online`, `uat.taxgenie.online`, or `taxgenie.online`)
- `TAXGENIE_DOMAIN_HOSTED_ZONE_ID` (Route 53 hosted-zone ID for the selected TaxGenie web domain)
- `AWS_REGION`
- `SES_FROM_EMAIL` (verified sender identity for reconciliation emails; use `notifications@taxgenie.online` by default)
- `TEST_EMAIL_RECIPIENT` (development-safe recipient override for reconciliation emails)
- `MERGE_BATCH_JOB_QUEUE` and `MERGE_BATCH_JOB_DEFINITION` are injected into the web runtime when merge Batch resources are deployed in the same stack; set them manually only for detached/local runtimes.
- `BATCH_RETENTION_FUNCTION_NAME` and `BATCH_RETENTION_FUNCTION_ARN` are injected into the web runtime when the retention Lambda is deployed in the same stack. For separated `web` and `backend` deployments, set both values (or Pulumi config `taxgenie:batchRetentionFunctionName` and `taxgenie:batchRetentionFunctionArn`) on the web deployment. The web runtime receives least-privilege `lambda:InvokeFunction` access to that ARN.

## Worker Extraction Variables

The deployed worker uses Gemini Developer API as its sole extraction provider. Store `GEMINI_API_KEY` through Pulumi secret `taxgenie:geminiApiKey` or the selected deployment env file; do not commit it.

```env
GEMINI_API_KEY=<secret>
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_THINKING_LEVEL=high
GEMINI_MEDIA_RESOLUTION=medium
GEMINI_TIMEOUT_MS=180000
SIGNATURE_VISUAL_DETECTOR_ENABLED=true
SIGNATURE_VISUAL_MIN_CONFIDENCE=0.86
SIGNATURE_VISUAL_DPI=400
SIGNATURE_VISUAL_TIMEOUT_MS=60000
PDF_TEXT_LAYER_FALLBACK_ENABLED=true
PAYOR_SIGNER_VERIFICATION_ENABLED=false
IDENTITY_CONFIDENCE_FLOW_ENABLED=true
```

The worker sends each original PDF to Gemini once. With identity confidence flow enabled, uncertain payee/payor name and TIN fields can each trigger one focused reread before deterministic reference validation. With payor signer verification disabled, Gemini signer identity fields remain authoritative while local PDF tooling continues to support page-count validation, certificate PDF reconstruction, and signature-presence fallback.

## LangSmith Cloud Tracing

Deployed workers enable the explicit LangSmith tracer and send redacted traces to the APAC endpoint over outbound HTTPS. Do not set `LANGSMITH_TRACING`; the worker supplies one explicit callback to avoid duplicate traces. Local tracing is disabled unless `TAXGENIE_LANGSMITH_ENABLED=true` and `LANGSMITH_API_KEY` are set.

## Sizing Variables

The infra uses stage-aware sizing defaults. `SST_STAGE=uat` and scoped stages such as `uat-app`, `uat-backend`, and `uat-web` use the proposed 8,000-certificate UAT profile automatically. `SST_STAGE=prod` and `prod-*` scoped stages use the production backup-retention profile while keeping the current compute defaults unless explicitly overridden.

| Variable                            | Default profile | UAT profile  | Prod profile | Purpose                                                                                      |
| ----------------------------------- | --------------- | ------------ | ------------ | -------------------------------------------------------------------------------------------- |
| `TAXGENIE_WORKER_COUNT`             | `1`             | `2`          | `1`          | Fixed worker EC2 count; accepts only `1` or `2`.                                             |
| `TAXGENIE_WORKER_INSTANCE_TYPE`     | `t3.medium`     | `m7i.large`  | `t3.medium`  | Async worker EC2 size.                                                                       |
| `TAXGENIE_WORKER_CONCURRENCY`       | `3`             | `3`          | `3`          | Worker container concurrency.                                                                |
| `TAXGENIE_DB_INSTANCE`              | `t4g.micro`     | `t4g.medium` | `t4g.micro`  | RDS Postgres instance class. `db.` prefix is accepted and stripped for SST.                  |
| `TAXGENIE_DB_STORAGE_GB`            | `20`            | `100`        | `20`         | RDS allocated storage.                                                                       |
| `TAXGENIE_DB_BACKUP_RETENTION_DAYS` | `1`             | `7`          | `30`         | RDS automated backup retention. RDS takes automated backups daily when retention is nonzero. |
| `TAXGENIE_NAT_INSTANCE_TYPE`        | `t3.micro`      | `t3.micro`   | `t3.micro`   | NAT EC2 size when NAT is enabled.                                                            |
| `TAXGENIE_MERGE_BATCH_MAX_VCPUS`    | `16`            | `16`         | `16`         | AWS Batch Fargate compute environment max vCPUs.                                             |
| `TAXGENIE_MERGE_JOB_VCPUS`          | `4`             | `4`          | `4`          | Merge worker job vCPU request.                                                               |
| `TAXGENIE_MERGE_JOB_MEMORY_MIB`     | `16384`         | `16384`      | `16384`      | Merge worker job memory request.                                                             |
| `TAXGENIE_MERGE_JOB_EPHEMERAL_GIB`  | `80`            | `80`         | `80`         | Merge worker job ephemeral storage.                                                          |

Deploy full UAT with:

```bash
TAXGENIE_ENV_FILE=.env.uat TAXGENIE_INFRA_PROFILE=full TAXGENIE_INFRA_SCOPE=all SST_STAGE=uat pnpm deploy:all
```

The stack outputs include `infraSizingProfile`, `workerCount`, `workerInstanceId`, `workerInstanceIds`, `workerInstanceType`, `dbInstance`, `dbStorageGb`, `dbBackupRetentionDays`, and Batch sizing values. `workerInstanceId` remains the primary worker for database tunnels; `workerInstanceIds` lists every worker. For UAT, verify `infraSizingProfile=uat`, `workerCount=2`, worker `m7i.large`, RDS `t4g.medium` with `100` GB storage, `dbBackupRetentionDays=7`, and Batch `4 vCPU / 16 GB / 80 GiB` with `maxVcpus=16`.

## Dev Worker Count Switch

Set `TAXGENIE_WORKER_COUNT=1` in `.env.dev` for a single worker or `TAXGENIE_WORKER_COUNT=2` for two fixed workers, then run `TAXGENIE_ENV_FILE=.env.dev pnpm deploy:all`. Automated Dev deployments use the GitHub `dev` Environment variable with the same name and fall back to one worker when it is unset. Scaling back to one removes only worker 2.

## Database Notes

- Production/staging infra now provisions `sst.aws.Postgres` (Amazon RDS PostgreSQL).
- The current cost-focused profile uses a single `t4g.micro` instance on Postgres `17` with `20 GB` storage. The UAT profile uses `t4g.medium` with `100 GB` storage.
- UAT and prod use RDS automated daily backups through `backupRetentionPeriod`: 7 days for UAT and 30 days for prod. Use `TAXGENIE_DB_BACKUP_RETENTION_DAYS` only for an explicitly approved override, within the RDS 1 to 35 day automated-backup range.
- `TAXGENIE_DB_PASSWORD` must be a valid RDS master password: 8 to 128 printable ASCII characters, with no `/`, `@`, double quotes, or spaces.
- The SST component name is intentionally different from the old Aurora-backed DB so existing stages recreate onto the non-serverless RDS instance instead of attempting an in-place component upgrade.
- Cloud database URLs are emitted with `sslmode=require`; local dev URLs stay unmodified.
- RDS stays private in every deployed environment. For temporary pgAdmin access, use `pnpm db:tunnel` to open an AWS SSM port-forwarding session through the worker EC2, then connect pgAdmin to `localhost:15432` with SSL mode `Require`.
- The tunnel requires AWS CLI v2, the Session Manager plugin, IAM permission to start SSM sessions, and the primary `workerInstanceId`/`dbHost` pair from the SST outputs. `workerInstanceIds` can be used to select the second worker manually if the primary is unavailable.
- During `sst deploy`, a VPC Lambda runs Drizzle migrations from `webapp/tax-genie/src/lib/migrations`.
- During `sst dev`, the migration invocation is skipped and Postgres can run in `dev` mode against `TAXGENIE_LOCAL_DATABASE_URL`.
- For local DB schema updates, run Drizzle locally: `pnpm db:generate:web` then `pnpm db:migrate:web`.
- The TanStack Start server runtime is attached to the VPC in full-profile AWS deployments so server-side auth and DB code can reach Postgres privately.
- Private subnets get an S3 gateway endpoint so VPC-attached Lambdas can still access S3 in no-NAT scopes.
- `backend` and `web` scope deployments skip NAT EC2 instance creation; `all` scope keeps NAT enabled for internet egress workloads.

## Domain and Email Prerequisites

Before deployment, configure DNS for `taxgenie.online` and its `dev` and `uat`
subdomains. Verify the `taxgenie.online` domain in Amazon SES so the application
can send authentication mail from `verify@taxgenie.online`, account-status mail
from `notifications@taxgenie.online`, and configured reconciliation mail.
