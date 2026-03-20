# Backend Infra Configuration

SST/Pulumi stack reads values from environment variables first, then from Pulumi config (`taxtrack:*`).

## Required Variables

- `TAXTRACK_DB_PASSWORD`
- `TAXTRACK_WORKER_ADMIN_TOKEN`
- `TAXTRACK_WORKER_IMAGE_URI`
- `TAXTRACK_ELECTRICSQL_IMAGE_URI`
- `TAXTRACK_LANGFUSE_PUBLIC_KEY`
- `TAXTRACK_LANGFUSE_SECRET_KEY`
- `TAXTRACK_LANGFUSE_SALT`

## Optional Variables

- `TAXTRACK_LANGFUSE_ACCESS_CIDRS` (comma-separated CIDRs)
- `TAXTRACK_LANGFUSE_HOST`
- `TAXTRACK_LOCAL_DATABASE_URL` (used by `sst dev` Postgres local mode; defaults to `postgresql://taxtrack:taxtrack@localhost:5432/taxtrack`)
- `TAXTRACK_AZ_PRIMARY` (defaults to `${AWS_REGION}a`)
- `TAXTRACK_AZ_SECONDARY` (defaults to `${AWS_REGION}b`)
- `AWS_REGION`

## Database Notes

- Production/staging infra now provisions `sst.aws.Postgres` (Amazon RDS PostgreSQL).
- The current cost-focused profile uses a single `t4g.micro` instance on Postgres `17` with `20 GB` storage.
- The SST component name is intentionally different from the old Aurora-backed DB so existing stages recreate onto the non-serverless RDS instance instead of attempting an in-place component upgrade.
- Cloud database URLs are emitted with `sslmode=require`; local dev URLs stay unmodified.
- During `sst deploy`, a VPC Lambda runs Drizzle migrations from `webapp/tax-track/src/lib/migrations`.
- During `sst dev`, the migration invocation is skipped and Postgres can run in `dev` mode against `TAXTRACK_LOCAL_DATABASE_URL`.
- For local DB schema updates, run Drizzle locally: `pnpm db:generate:web` then `pnpm db:migrate:web`.
- The TanStack Start server runtime is attached to the VPC in full-profile AWS deployments so server-side auth and DB code can reach Postgres privately.
- Private subnets get an S3 gateway endpoint so VPC-attached Lambdas can still access S3 in no-NAT scopes.
- `backend` and `web` scope deployments skip NAT EC2 instance creation; `all` scope keeps NAT enabled for internet egress workloads.

## ElectricSQL Notes

- `all` scope deploys ElectricSQL on EC2 behind a public ALB and a dedicated CloudFront distribution.
- `app` scope deploys the webapp + RDS Postgres + ElectricSQL + upload processing resources.
- The browser-safe URL is exposed as the `electricSqlUrl` stack output.
- The webapp receives this value as both `ELECTRICSQL_URL` and `VITE_ELECTRICSQL_URL` when ElectricSQL is deployed in the same stack.
