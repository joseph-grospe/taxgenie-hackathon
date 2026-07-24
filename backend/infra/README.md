# Backend Infra Configuration

SST/Pulumi stack reads values from environment variables first, then from Pulumi config (`taxtrack:*`).

## Required Variables

- `TAXTRACK_DB_PASSWORD`
- `TAXTRACK_WORKER_ADMIN_TOKEN`
- `TAXTRACK_WORKER_IMAGE_URI` (`pnpm deploy:worker` writes the latest built image URI back to the local env file)
- `TAXTRACK_MERGE_WORKER_IMAGE_URI` (`pnpm deploy:merge-worker` writes the latest built image URI back to the local env file)
- `TAXTRACK_LANGFUSE_PUBLIC_KEY`
- `TAXTRACK_LANGFUSE_SECRET_KEY`
- `TAXTRACK_LANGFUSE_SALT`
- `TAXTRACK_LANGFUSE_INIT_USER_EMAIL`
- `TAXTRACK_LANGFUSE_INIT_USER_PASSWORD`

## Optional Variables

- `WORKER_ECR_REPOSITORY` (used by the local `pnpm deploy:worker` publish-and-deploy command)
- `MERGE_WORKER_ECR_REPOSITORY` (used by the local `pnpm deploy:merge-worker` publish-and-deploy command)
- `TAXTRACK_WORKER_IMAGE_SOURCE_HASH` and `TAXTRACK_MERGE_WORKER_IMAGE_SOURCE_HASH` are maintained by deploy scripts to skip unchanged Docker image builds.
- `TAXTRACK_WORKER_IMAGE_FORCE=1` and `TAXTRACK_MERGE_WORKER_IMAGE_FORCE=1` bypass image hash reuse for one deploy.
- `TAXTRACK_WORKER_COUNT` accepts only `1` or `2`. Dev defaults to `1`; UAT and `uat-*` stages default to `2`.
- `TAXTRACK_DB_TUNNEL_INSTANCE_ID` (used by `pnpm db:tunnel`; set to the deployed `workerInstanceId` output or another SSM-enabled EC2 instance that can reach RDS)
- `TAXTRACK_DB_TUNNEL_HOST` (used by `pnpm db:tunnel`; set to the deployed `dbHost` output when `DATABASE_URL` is not available locally)
- `TAXTRACK_DB_TUNNEL_LOCAL_PORT` and `TAXTRACK_DB_TUNNEL_REMOTE_PORT` (optional tunnel port overrides; defaults are `15432` and `5432`)
- `TAXTRACK_LANGFUSE_ACCESS_CIDRS` (comma-separated CIDRs)
- `TAXTRACK_LANGFUSE_HOST`
- `TAXTRACK_LANGFUSE_INIT_USER_NAME`
- `TAXTRACK_LOCAL_DATABASE_URL` (used by `sst dev` Postgres local mode; defaults to `postgresql://taxtrack:taxtrack@localhost:5432/taxtrack`)
- `TAXTRACK_AZ_PRIMARY` (defaults to `${AWS_REGION}a`)
- `TAXTRACK_AZ_SECONDARY` (defaults to `${AWS_REGION}b`)
- `AWS_REGION`
- `SES_FROM_EMAIL` (sender identity for reconciliation emails)
- `TEST_EMAIL_RECIPIENT` (development-safe recipient override for reconciliation emails)
- `MERGE_BATCH_JOB_QUEUE` and `MERGE_BATCH_JOB_DEFINITION` are injected into the web runtime when merge Batch resources are deployed in the same stack; set them manually only for detached/local runtimes.

## Sizing Variables

The infra uses stage-aware sizing defaults. `SST_STAGE=uat` and scoped stages such as `uat-app`, `uat-backend`, and `uat-web` use the proposed 8,000-certificate UAT profile automatically. `SST_STAGE=prod` and `prod-*` scoped stages use the production backup-retention profile while keeping the current compute defaults unless explicitly overridden.

| Variable | Default profile | UAT profile | Prod profile | Purpose |
| --- | --- | --- | --- | --- |
| `TAXTRACK_WORKER_COUNT` | `1` | `2` | `1` | Fixed worker EC2 count; accepts only `1` or `2`. |
| `TAXTRACK_WORKER_INSTANCE_TYPE` | `t3.medium` | `m7i.large` | `t3.medium` | Async worker EC2 size. |
| `TAXTRACK_WORKER_CONCURRENCY` | `3` | `3` | `3` | Worker container concurrency. |
| `TAXTRACK_DB_INSTANCE` | `t4g.micro` | `t4g.medium` | `t4g.micro` | RDS Postgres instance class. `db.` prefix is accepted and stripped for SST. |
| `TAXTRACK_DB_STORAGE_GB` | `20` | `100` | `20` | RDS allocated storage. |
| `TAXTRACK_DB_BACKUP_RETENTION_DAYS` | `1` | `7` | `30` | RDS automated backup retention. RDS takes automated backups daily when retention is nonzero. |
| `TAXTRACK_NAT_INSTANCE_TYPE` | `t3.micro` | `t3.micro` | `t3.micro` | NAT EC2 size when NAT is enabled. |
| `TAXTRACK_LANGFUSE_INSTANCE_TYPE` | `t3.micro` | `t3.small` | `t3.micro` | Langfuse EC2 size. |
| `TAXTRACK_LANGFUSE_ROOT_VOLUME_GB` | `100` | `100` | `100` | Langfuse root gp3 volume size. |
| `TAXTRACK_MERGE_BATCH_MAX_VCPUS` | `16` | `16` | `16` | AWS Batch Fargate compute environment max vCPUs. |
| `TAXTRACK_MERGE_JOB_VCPUS` | `4` | `4` | `4` | Merge worker job vCPU request. |
| `TAXTRACK_MERGE_JOB_MEMORY_MIB` | `16384` | `16384` | `16384` | Merge worker job memory request. |
| `TAXTRACK_MERGE_JOB_EPHEMERAL_GIB` | `80` | `80` | `80` | Merge worker job ephemeral storage. |

Deploy full UAT with:

```bash
TAXTRACK_ENV_FILE=.env.uat TAXTRACK_INFRA_PROFILE=full TAXTRACK_INFRA_SCOPE=all SST_STAGE=uat pnpm deploy:all
```

The stack outputs include `infraSizingProfile`, `workerCount`, `workerInstanceId`, `workerInstanceIds`, `workerInstanceType`, `dbInstance`, `dbStorageGb`, `dbBackupRetentionDays`, `langfuseInstanceType`, and Batch sizing values. `workerInstanceId` remains the primary worker for database tunnels; `workerInstanceIds` lists every worker. For UAT, verify `infraSizingProfile=uat`, `workerCount=2`, worker `m7i.large`, RDS `t4g.medium` with `100` GB storage, `dbBackupRetentionDays=7`, Langfuse `t3.small`, and Batch `4 vCPU / 16 GB / 80 GiB` with `maxVcpus=16`.

## Dev Worker Count Switch

Set `TAXTRACK_WORKER_COUNT=1` in `.env.dev` for a single worker or `TAXTRACK_WORKER_COUNT=2` for two fixed workers, then run `TAXTRACK_ENV_FILE=.env.dev pnpm deploy:all`. Automated Dev deployments use the GitHub `dev` Environment variable with the same name and fall back to one worker when it is unset. Scaling back to one removes only worker 2.

## Database Notes

- Production/staging infra now provisions `sst.aws.Postgres` (Amazon RDS PostgreSQL).
- The current cost-focused profile uses a single `t4g.micro` instance on Postgres `17` with `20 GB` storage. The UAT profile uses `t4g.medium` with `100 GB` storage.
- UAT and prod use RDS automated daily backups through `backupRetentionPeriod`: 7 days for UAT and 30 days for prod. Use `TAXTRACK_DB_BACKUP_RETENTION_DAYS` only for an explicitly approved override, within the RDS 1 to 35 day automated-backup range.
- `TAXTRACK_DB_PASSWORD` must be a valid RDS master password: 8 to 128 printable ASCII characters, with no `/`, `@`, double quotes, or spaces.
- The SST component name is intentionally different from the old Aurora-backed DB so existing stages recreate onto the non-serverless RDS instance instead of attempting an in-place component upgrade.
- Cloud database URLs are emitted with `sslmode=require`; local dev URLs stay unmodified.
- RDS stays private in every deployed environment. For temporary pgAdmin access, use `pnpm db:tunnel` to open an AWS SSM port-forwarding session through the worker EC2, then connect pgAdmin to `localhost:15432` with SSL mode `Require`.
- The tunnel requires AWS CLI v2, the Session Manager plugin, IAM permission to start SSM sessions, and the primary `workerInstanceId`/`dbHost` pair from the SST outputs. `workerInstanceIds` can be used to select the second worker manually if the primary is unavailable.
- During `sst deploy`, a VPC Lambda runs Drizzle migrations from `webapp/tax-track/src/lib/migrations`.
- During `sst dev`, the migration invocation is skipped and Postgres can run in `dev` mode against `TAXTRACK_LOCAL_DATABASE_URL`.
- For local DB schema updates, run Drizzle locally: `pnpm db:generate:web` then `pnpm db:migrate:web`.
- The TanStack Start server runtime is attached to the VPC in full-profile AWS deployments so server-side auth and DB code can reach Postgres privately.
- Private subnets get an S3 gateway endpoint so VPC-attached Lambdas can still access S3 in no-NAT scopes.
- `backend` and `web` scope deployments skip NAT EC2 instance creation; `all` scope keeps NAT enabled for internet egress workloads.
