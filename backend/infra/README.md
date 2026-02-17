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
- `AWS_REGION`
