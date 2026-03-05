# Backend Infra Configuration

SST/Pulumi stack reads values from environment variables first, then from Pulumi config (`taxtrack:*`).

## Required Variables

- `TAXTRACK_DB_PASSWORD`
- `TAXTRACK_WEBHOOK_SECRET`
- `TAXTRACK_WORKER_ADMIN_TOKEN`
- `TAXTRACK_WORKER_IMAGE_URI`
- `TAXTRACK_ELECTRICSQL_IMAGE_URI`
- `TAXTRACK_LANGFUSE_PUBLIC_KEY`
- `TAXTRACK_LANGFUSE_SECRET_KEY`
- `TAXTRACK_LANGFUSE_SALT`

## Optional Variables

- `TAXTRACK_LANGFUSE_ACCESS_CIDRS` (comma-separated CIDRs)
- `TAXTRACK_LANGFUSE_HOST`
- `TAXTRACK_LOCAL_DATABASE_URL` (used by `sst dev` Aurora local mode; defaults to `postgresql://taxtrack:taxtrack@localhost:5432/taxtrack`)
- `TAXTRACK_AZ_PRIMARY` (defaults to `${AWS_REGION}a`)
- `TAXTRACK_AZ_SECONDARY` (defaults to `${AWS_REGION}b`)
- `AWS_REGION`

## Database Notes

- Production/staging infra now provisions `sst.aws.Aurora` (Aurora PostgreSQL Serverless v2).
- Aurora is configured for a single writer instance (`replicas: 0`) on Postgres `17`.
- Current test scaling profile is the lowest-cost setup: `min: "0 ACU"`, `max: "1 ACU"`, `pauseAfter: "5 minutes"`.
- During `sst deploy`, a VPC Lambda runs Drizzle migrations from `webapp/tax-track/src/lib/migrations`.
- During `sst dev`, the migration invocation is skipped and Aurora can run in `dev` mode against `TAXTRACK_LOCAL_DATABASE_URL`.
- For local DB schema updates, run Drizzle locally: `pnpm db:generate:web` then `pnpm db:migrate:web`.
- `backend` and `web` scope deployments skip NAT EC2 instance creation; `all` scope keeps NAT enabled for internet egress workloads.
