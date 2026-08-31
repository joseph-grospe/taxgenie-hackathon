# TaxGenie minimum GCP production stack

This package supports two deployment profiles. `production` remains the
default and retains the full architecture documented below. `hackathon` is a
separate near-zero-cost Neon + Cloud Run judging environment documented in
[HACKATHON.md](HACKATHON.md).

This Pulumi package is the active production infrastructure for
`taxgenie.online`. It provisions a private GCS bucket, Cloud SQL PostgreSQL 17,
Cloud Tasks, private worker and load-balancer-only web Cloud Run services,
Artifact Registry, Secret Manager, Cloud DNS, Certificate Manager, the global
HTTPS load balancer, logging, and alerts in `asia-southeast1`.

The production database and bucket are intentionally fresh. No AWS database
rows, S3 objects, or object versions are copied or synchronized.

## Bootstrap and deploy

Prerequisites: authenticated `gcloud`, Pulumi CLI, access to the production GCP
project, and a configured Pulumi state backend.

```bash
export GCP_PROJECT_ID=<production-project>
export GCP_REGION=asia-southeast1
export PULUMI_STACK=prod

cd backend/infra-gcp
pulumi stack init prod # only for a new stack
pulumi config set gcp:project "$GCP_PROJECT_ID"
pulumi config set --secret geminiApiKey '<gemini-developer-api-key>'
pulumi config set --secret langsmithApiKey
pulumi config set langsmithProject taxgenie-production
pulumi config set --secret betterAuthSecret '<32+-character-secret>'
pulumi config set --secret dbPassword '<database-password>'
pulumi config set --secret seedEmail '<administrator-email>'
pulumi config set --secret seedPassword '<administrator-password>'
cd ../..

pnpm deploy:bootstrap
pnpm deploy:all
```

`deploy:bootstrap` leaves `deployServices=false` for a new stack and never turns
it off on an existing stack. `deploy:all` builds all three images, writes their
immutable digests to Pulumi config, applies the services, executes the
migration/seed job, and checks the load-balancer endpoint, private ingress,
worker authentication, and bucket IAM. `deploy:images` remains available when
only the image-build stage is needed.

LangSmith tracing is optional. Setting the encrypted `langsmithApiKey` enables
it for the worker and defaults the project to `taxgenie-production` and the
endpoint to `https://apac.api.smith.langchain.com`. Override those defaults with
the plaintext Pulumi keys `langsmithProject` and `langsmithEndpoint`, or set
`langsmithEnabled=false` to keep a configured key mounted nowhere. The local
`.env` file is excluded from container builds and is never uploaded.

To rotate only the deployed LangSmith key, no image rebuild is required:

```bash
pulumi --cwd backend/infra-gcp config set --secret langsmithApiKey --stack prod
pulumi --cwd backend/infra-gcp up --yes --stack prod
```

The first command prompts for the value without printing it. The new Secret
Manager version is pinned into a new Cloud Run worker revision.

Do not set `enableDnsCutover=true` until the DNS and maintenance-window steps in
[CUTOVER.md](CUTOVER.md) are complete.

## Runtime guarantees

- Worker: 2 vCPU, 4 GiB, concurrency 1, 0–3 instances, 1,800-second timeout.
- Web: 1 vCPU, 1 GiB, concurrency 20, 0–3 instances, 300-second timeout.
- Queue: three concurrent dispatches, five attempts, 10–600 second backoff,
  24-hour retry window.
- Cloud SQL: PostgreSQL 17, `db-custom-1-3840`, 20 GiB SSD, seven backups,
  PITR, deletion protection.
- Gemini: `gemini-3.5-flash`, high primary thinking, focused minimal rereads.
- Production flags: merge, outbound email, and purge are all false.
