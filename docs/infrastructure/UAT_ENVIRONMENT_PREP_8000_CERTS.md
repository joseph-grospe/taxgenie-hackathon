# UAT Environment Preparation for 8,000 BIR 2307 Certificates per Month

This checklist assumes "8,000 2307 certificates per month" means 8,000 BIR Form 2307 PDF certificates processed monthly.

## Workload Assumptions

- Monthly volume: 8,000 certificates.
- Average daily volume: about 267 certificates per day.
- Primary risk: cutoff-period bursts, not the monthly average.
- Burst test target: 2,000 to 8,000 certificates uploaded in a short UAT window.
- Each uploaded PDF creates one SQS message and one async worker processing job.
- Gemini request and token quotas are expected to cap throughput before EC2 CPU in many runs.

## Required UAT Environment File

Create a dedicated `.env.uat` from `.env.sample`:

```bash
cp .env.sample .env.uat
```

Use it explicitly for UAT commands:

```bash
TAXTRACK_ENV_FILE=.env.uat <command>
```

## Environment Variables

### Deployment and AWS

| Variable | Required for UAT | Purpose / UAT value |
| --- | --- | --- |
| `TAXTRACK_ENV_FILE` | Yes | Use `.env.uat` when running scripts. |
| `AWS_REGION` | Yes | Recommended current repo default: `ap-southeast-1`. |
| `AWS_PROFILE` | Local/operator | Use when deploying from a named AWS CLI profile. Do not combine with static AWS keys unless needed. |
| `AWS_ACCESS_KEY_ID` | Alternative | Static AWS credential for local/operator commands if no profile is used. |
| `AWS_SECRET_ACCESS_KEY` | Alternative | Static AWS credential for local/operator commands if no profile is used. |
| `AWS_SESSION_TOKEN` | Alternative | Required only for temporary static AWS credentials. |
| `SST_STAGE` | Yes | Use `uat` for full UAT deployment. |
| `TAXTRACK_INFRA_PROFILE` | Yes | Use `full` for AWS UAT. `localdev` is only for local/dev shortcuts. |
| `TAXTRACK_INFRA_SCOPE` | Usually | Use `all` for full UAT. Script can set this automatically. |
| `TAXTRACK_WORKER_COUNT` | Recommended | Use `2` for UAT multi-worker mode. Set `1` and redeploy to remove only worker 2 during rollback. |
| `TAXTRACK_AZ_PRIMARY` | Optional | Defaults to `${AWS_REGION}a`. |
| `TAXTRACK_AZ_SECONDARY` | Optional | Defaults to `${AWS_REGION}b`. |

### Images and ECR

| Variable | Required for UAT | Purpose / UAT value |
| --- | --- | --- |
| `WORKER_ECR_REPOSITORY` | Yes for build script | ECR repository URI for the async worker image, without tag. |
| `MERGE_WORKER_ECR_REPOSITORY` | Yes for build script | ECR repository URI for the PDF merge worker image, without tag. |
| `TAXTRACK_WORKER_IMAGE_URI` | Yes for deploy | Full worker image URI. The deploy script writes this after build. |
| `TAXTRACK_WORKER_IMAGE_SOURCE_HASH` | Script-managed | Used to skip unchanged worker image builds. |
| `TAXTRACK_WORKER_IMAGE_FORCE` | Optional | Set to `1` to force a rebuild. |
| `TAXTRACK_MERGE_WORKER_IMAGE_URI` | Yes for deploy | Full merge-worker image URI. The deploy script writes this after build. |
| `TAXTRACK_MERGE_WORKER_IMAGE_SOURCE_HASH` | Script-managed | Used to skip unchanged merge-worker image builds. |
| `TAXTRACK_MERGE_WORKER_IMAGE_FORCE` | Optional | Set to `1` to force a rebuild. |

### Web, Auth, Domain, Users

| Variable | Required for UAT | Purpose / UAT value |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Yes | Strong UAT auth secret. Do not reuse local/dev. |
| `BETTER_AUTH_URL` | Yes | `https://uat.taxtrack.online` or the final UAT CloudFront/domain URL. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Optional | Additional allowed origins if UAT has alternate domains. |
| `TAXTRACK_WEB_DOMAIN` | Optional | Overrides stage domain. Existing mapping supports `uat.taxtrack.online`. |
| `TAXTRACK_DOMAIN_HOSTED_ZONE_ID` | Optional | Required if SST should manage Route 53 DNS for the custom UAT domain. |
| `TAXTRACK_SEED_EMAIL` | Recommended | Initial UAT admin email. |
| `TAXTRACK_SEED_PASSWORD` | Recommended | Initial UAT admin password. Rotate after handoff. |
| `TAXTRACK_SEED_NAME` | Optional | Defaults to `TaxTrack Admin`. |
| `TAXTRACK_APP_STAGE` | Injected | Set by SST for the web runtime. Do not set manually unless detached. |

### Database

| Variable | Required for UAT | Purpose / UAT value |
| --- | --- | --- |
| `TAXTRACK_DB_PASSWORD` | Yes | RDS Postgres password created by infra. |
| `TAXTRACK_DB_TUNNEL_INSTANCE_ID` | Required for pgAdmin tunnel | Deployed `workerInstanceId` output, or another SSM-enabled EC2 instance that can reach private RDS. |
| `TAXTRACK_DB_TUNNEL_HOST` | Required for pgAdmin tunnel if no local `DATABASE_URL` | Deployed `dbHost` output. |
| `TAXTRACK_DB_TUNNEL_LOCAL_PORT` | Optional | Local pgAdmin port; defaults to `15432`. |
| `TAXTRACK_DB_TUNNEL_REMOTE_PORT` | Optional | Remote Postgres port; defaults to `5432`. |
| `DATABASE_URL` | Injected/manual | SST injects RDS URL in full UAT. Required manually only for detached/local runtimes. |
| `TAXTRACK_LOCAL_DATABASE_URL` | Local only | Used by `sst dev`, not normal UAT deploy. |
| `DRIZZLE_MIGRATIONS_DIR` | Lambda internal | Migration Lambda sets this internally. |

For pgAdmin UAT access, keep RDS private and use an SSM tunnel:

```bash
TAXTRACK_DB_TUNNEL_INSTANCE_ID=<workerInstanceId>
TAXTRACK_DB_TUNNEL_HOST=<dbHost>
TAXTRACK_DB_TUNNEL_LOCAL_PORT=15432
```

Do not make RDS public for UAT debugging.

### Storage, Queue, and Merge

| Variable | Required for UAT | Purpose / UAT value |
| --- | --- | --- |
| `S3_REGION` | Recommended | Use same as `AWS_REGION`, usually `ap-southeast-1`. |
| `S3_BUCKET_NAME` | Injected/manual | SST injects the UAT bucket name. Required manually only for detached/local runtimes. |
| `S3_OBJECT_PREFIX` | Recommended | Use `v2`. Defaults to `v2` in shared storage helpers. |
| `S3_MAX_KEYS` | Optional | Listing page size. Sample uses `100`. |
| `SQS_QUEUE_URL` | Injected/manual | SST injects for web and worker. Required manually only for detached/local runtimes. |
| `SQS_DLQ_URL` | Optional/manual | Useful for local/detached worker operations. |
| `MERGE_BATCH_JOB_QUEUE` | Injected/manual | SST injects when merge Batch is deployed in the same stack. |
| `MERGE_BATCH_JOB_DEFINITION` | Injected/manual | SST injects when merge Batch is deployed in the same stack. |
| `MERGE_JOBS_SKIP_AWS_BATCH` | Local/UAT testing only | Set `true` only when testing merge jobs manually without AWS Batch. Use `false` for real UAT. |
| `MERGE_JOB_ID` | Local merge worker only | Required only when running `pnpm dev:merge-worker` or `pnpm test:merge-worker`. |

Legacy/sample aliases: `S3_BUCKET`, `S3_SOURCE_BUCKET_NAME`, `S3_RESULTS_BUCKET_NAME`, and `S3_PREFIX` appear in `.env.sample`, but current SST runtime uses `S3_BUCKET_NAME` and `S3_OBJECT_PREFIX`.

### Worker Runtime

| Variable | Required for UAT | Purpose / UAT value |
| --- | --- | --- |
| `TAXTRACK_WORKER_ADMIN_TOKEN` | Yes | Infra secret source for worker admin token. |
| `ADMIN_TOKEN` | Injected/manual | Worker runtime admin token. Required manually for local/detached worker. |
| `WORKER_PORT` | Local/manual | Worker defaults to `3001`. Current EC2 deploy exposes `3001`. |
| `WORKER_CONCURRENCY` | Local/manual | Current EC2 deploy hardcodes `3`. Env value applies to local/detached worker unless infra is changed. |
| `SQS_WAIT_TIME_SECONDS` | Local/manual | Current EC2 deploy hardcodes `20`. |
| `SQS_VISIBILITY_TIMEOUT_SECONDS` | Local/manual | Current EC2 deploy hardcodes `300`. |

For 8,000/month UAT, keep EC2 worker concurrency conservative until Gemini quotas are confirmed. Increasing instance size without provider quota usually will not increase throughput.

### Agentic extraction

| Variable | Required for UAT | Purpose / UAT value |
| --- | --- | --- |
| `GEMINI_API_KEY` | Required | Gemini Developer API secret. Configure it as the Pulumi `geminiApiKey` secret or runtime env value. |
| `GEMINI_MODEL` | Optional | Defaults to the exact preview ID `gemini-3-flash-preview`; do not use a floating `latest` alias. |
| `GEMINI_THINKING_LEVEL` | Optional | Defaults to `high`. |
| `GEMINI_MEDIA_RESOLUTION` | Optional | Defaults to `medium`. |
| `GEMINI_TIMEOUT_MS` | Optional | Defaults to `180000`. Timeouts and HTTP 429/500/502/503/504 are retried twice. |

### Validation and Business Rules

| Variable | Required for UAT | Purpose / UAT value |
| --- | --- | --- |
| ATC rate configuration | Database-managed | Import ATC rates through `POST /api/atc-codes/import`; worker validation reads rates from the database for each document. |
| `VARIANCE_THRESHOLD_PHP` | Optional | Defaults to `100`. |
| `SIGNATURE_VISUAL_DETECTOR_ENABLED` | Optional | Defaults to `true`. |
| `SIGNATURE_VISUAL_MIN_CONFIDENCE` | Optional | Defaults to `0.86`; promotion also requires the payor signer band to be visible. |
| `SIGNATURE_VISUAL_DPI` | Optional | Defaults to `400`. |
| `SIGNATURE_VISUAL_TIMEOUT_MS` | Optional | Defaults to `60000`. |
| `PDF_TEXT_LAYER_FALLBACK_ENABLED` | Optional | Defaults to `true`; may recover signer name/title/TIN, never signature presence. |
| `PAYOR_SIGNER_VERIFICATION_ENABLED` | Optional | Defaults to `false`; when disabled, Gemini signer identity fields remain authoritative and the text/crop verifier is not called. |

### Observability and Email

| Variable | Required for UAT | Purpose / UAT value |
| --- | --- | --- |
| `TAXTRACK_LANGFUSE_PUBLIC_KEY` | Yes for full deploy | Infra secret for deployed Langfuse and worker tracing. |
| `TAXTRACK_LANGFUSE_SECRET_KEY` | Yes for full deploy | Infra secret for deployed Langfuse and worker tracing. |
| `TAXTRACK_LANGFUSE_SALT` | Yes for full deploy | Langfuse bootstrap secret. |
| `TAXTRACK_LANGFUSE_HOST` | Optional | Override Langfuse host. If unset, worker uses deployed Langfuse URL. |
| `TAXTRACK_LANGFUSE_ACCESS_CIDRS` | Recommended | Comma-separated CIDRs allowed to access Langfuse. Avoid `0.0.0.0/0` for UAT if possible. |
| `LANGFUSE_ENABLED` | Local/manual | Worker runtime flag. |
| `LANGFUSE_HOST` | Local/manual | Local/detached worker host. |
| `LANGFUSE_PUBLIC_KEY` | Local/manual | Local/detached worker public key. |
| `LANGFUSE_SECRET_KEY` | Local/manual | Local/detached worker secret key. |
| `SES_FROM_EMAIL` | Required if sending email | SES sender identity. |
| `TEST_EMAIL_RECIPIENT` | Recommended for UAT | Development-safe recipient override. |

## Scripts and Commands to Run

### One-time local setup

```bash
pnpm install
```

Optional local POC backend only:

```bash
uv pip install -r pyproject.toml
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### First UAT bootstrap

The update scripts build one image and immediately run a full SST deploy. For a brand-new UAT stack, both worker image URIs must exist before the first full deploy, so bootstrap both images first.

```bash
export TAXTRACK_ENV_FILE=.env.uat
set -a && source .env.uat && set +a

aws ecr create-repository --repository-name taxtrack-worker-uat --region "$AWS_REGION" || true
aws ecr create-repository --repository-name taxtrack-merge-worker-uat --region "$AWS_REGION" || true

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${WORKER_ECR_REPOSITORY%/*}"

docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  -f backend/worker/Dockerfile \
  -t "${WORKER_ECR_REPOSITORY}:uat-bootstrap" \
  --push \
  .

docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  -f backend/merge-worker/Dockerfile \
  -t "${MERGE_WORKER_ECR_REPOSITORY}:uat-bootstrap" \
  --push \
  .
```

Then set these in `.env.uat`:

```bash
TAXTRACK_WORKER_IMAGE_URI=<worker-ecr-repo>:uat-bootstrap
TAXTRACK_MERGE_WORKER_IMAGE_URI=<merge-worker-ecr-repo>:uat-bootstrap
```

Deploy full UAT:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:all
```

`pnpm deploy:all` runs SST deploy and, outside `sst dev`, invokes the Drizzle migration Lambda automatically.

### pgAdmin access for UAT

1. Confirm the deployed stack outputs include `workerCount=2`, both values in `workerInstanceIds`, the primary `workerInstanceId`, `dbHost`, and `databaseUrl`.
2. Set `TAXTRACK_DB_TUNNEL_INSTANCE_ID=<workerInstanceId>` and `TAXTRACK_DB_TUNNEL_HOST=<dbHost>` in `.env.uat`, or export them in the shell.
3. Start the tunnel:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm db:tunnel
```

4. In pgAdmin, connect to host `localhost`, port `15432`, SSL mode `Require`.
5. Use database name, username, and password from the deployed `databaseUrl` output.

The tunnel needs AWS CLI v2, the AWS Session Manager plugin, IAM permission to start SSM sessions, and an SSM-enabled instance that can reach RDS. Stages without a worker EC2 need another SSM-enabled instance in the same VPC/security path. When UAT debugging is done, stop the terminal session.

### Normal UAT updates

Web/app/runtime update:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:all
```

Web-only update:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:web
```

Worker image update:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:worker
```

Merge worker image update:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:merge-worker
```

Force rebuilds when required:

```bash
TAXTRACK_ENV_FILE=.env.uat TAXTRACK_WEB_BUILD_FORCE=1 pnpm deploy:web
TAXTRACK_ENV_FILE=.env.uat TAXTRACK_WORKER_IMAGE_FORCE=1 pnpm deploy:worker
TAXTRACK_ENV_FILE=.env.uat TAXTRACK_MERGE_WORKER_IMAGE_FORCE=1 pnpm deploy:merge-worker
```

### Validation commands

```bash
pnpm typecheck
pnpm test
```

For local merge-worker verification:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm test:merge-worker -- --list
TAXTRACK_ENV_FILE=.env.uat pnpm test:merge-worker -- <merge-job-id>
```

## Compute Sizing for 8,000 Certificates per Month

AWS describes general purpose EC2 instances as balanced compute, memory, and networking resources for app servers and similar workloads. AWS describes T3 as burstable general purpose for moderate CPU usage with temporary spikes, while M7i is better suited to higher continuous CPU usage. That maps well to this UAT decision: T3/T3a can be cost-sensitive UAT, while M7i is safer for sustained load tests.

### Current Infrastructure Values

| Component | Current default value |
| --- | --- |
| Async worker EC2 | `t3.medium`, one instance, x86_64 AMI, Docker image built as `linux/amd64`, worker concurrency defaults to `3`. |
| NAT EC2 | `t3.micro`. |
| Langfuse EC2 | `t3.micro`, 100 GB gp3 root volume. |
| RDS Postgres | `db.t4g.micro`, Postgres 17, 20 GB storage. |
| Merge jobs | AWS Batch on Fargate, `4 vCPU`, `16 GB`, `80 GiB` ephemeral storage, `maxVcpus=16`. |
| Web/API | SST TanStack Start on AWS Lambda/CloudFront, not EC2. |

### Recommended UAT Instance Types

| Component | Recommended UAT size | Cost-sensitive option | Scale-up trigger |
| --- | --- | --- | --- |
| Async worker EC2 | `m7i.large` | `t3.large` | SQS oldest message age keeps rising and Gemini quotas are not the bottleneck. |
| NAT EC2 | `t3.micro` | Keep current | Move to `t3.small` or NAT Gateway if private subnet egress is unstable. |
| Langfuse EC2 | `t3.small` | Keep current `t3.micro` only for light tracing | Move to `t3.medium` or reduce tracing if ingest is heavy during 8,000-document tests. |
| RDS Postgres | `db.t4g.medium`, 50 to 100 GB gp3 | `db.t4g.small` for smoke UAT only | Move to `db.m7g.large` if dashboard/reconciliation p95 latency or DB CPU is high. |
| Merge Batch Fargate | Keep `4 vCPU / 16 GB` | `2 vCPU / 8 GB` only after testing large PDFs | Increase `maxVcpus` from 16 to 32 if multiple large merges queue. |
| Web/API | No EC2 type in current infra | If moved to EC2: `t3.medium` | If sustained load is expected on EC2: `m7i.large`. |

### Practical UAT Recommendation

For UAT that actually tests 8,000 certificates/month behavior:

```txt
Worker EC2: m7i.large
Worker count: 2 fixed EC2 workers in UAT; set TAXTRACK_WORKER_COUNT=1 for rollback
Worker concurrency: 3 initially, then tune after Gemini quota confirmation
Database: db.t4g.medium, 50 to 100 GB gp3
Merge Batch: 4 vCPU / 16 GB, maxVcpus 16
Langfuse: t3.small or disable/restrict tracing volume
NAT: t3.micro for UAT
```

## Estimated UAT Monthly Cost

Estimate date: May 11, 2026. Region assumption: AWS Asia Pacific (Singapore), `ap-southeast-1`. Pricing uses on-demand Linux/Unix EC2, single-AZ RDS PostgreSQL, gp3 storage, and Fargate Linux/x86 rates. Use this as a planning number only; actual bills vary by data transfer, logs, test duration, artifact size, and pricing changes.

### Current Code Profile

This profile matches the infrastructure defaults currently configured in the repo.

| Item | Assumption | Estimated monthly cost |
| --- | --- | ---: |
| Worker EC2 | 1 x `t3.medium`, 730 hours | USD 38.54 |
| NAT EC2 | 1 x `t3.micro`, 730 hours | USD 9.64 |
| Langfuse EC2 | 1 x `t3.micro`, 730 hours | USD 9.64 |
| RDS PostgreSQL | `db.t4g.micro`, single-AZ, 730 hours | USD 18.25 |
| RDS storage | 20 GB gp3 | USD 2.76 |
| EC2 EBS storage | 100 GB Langfuse gp3 root + about 16 GB other gp3 roots | USD 11.15 |
| Merge Batch Fargate | 4 vCPU / 16 GB / 80 GiB job profile, light UAT usage | USD 5 to 20 |
| Web/API hosting | SST TanStack Start on Lambda/CloudFront, low UAT traffic | USD 5 to 20 |
| S3, SQS, CloudWatch | Source/artifact storage, queueing, logs, alarms | USD 15 to 45 |

Expected current-code UAT total:

```txt
About USD 115 to 175 per month
Planning buffer: USD 200 per month
```

### Recommended 8,000-Certificate UAT Profile

This profile uses the larger worker and database sizing recommended above for realistic UAT load testing.

| Item | Assumption | Estimated monthly cost |
| --- | --- | ---: |
| Worker EC2 | 2 x `m7i.large`, 730 hours each | USD 183.96 |
| NAT EC2 | 1 x `t3.micro`, 730 hours | USD 9.64 |
| Langfuse EC2 | 1 x `t3.small`, 730 hours | USD 19.27 |
| RDS PostgreSQL | `db.t4g.medium`, single-AZ, 730 hours | USD 74.46 |
| RDS storage | 50 to 100 GB gp3 | USD 6.90 to 13.80 |
| EC2 EBS storage | 100 GB Langfuse gp3 root + about 24 GB other gp3 roots | USD 11.90 |
| Merge Batch Fargate | 4 vCPU / 16 GB / 80 GiB job profile, heavier UAT usage | USD 5 to 25 |
| Web/API hosting | SST TanStack Start on Lambda/CloudFront, low to moderate UAT traffic | USD 5 to 25 |
| S3, SQS, CloudWatch | Source/artifact storage, queueing, logs, alarms | USD 20 to 55 |

Expected recommended UAT total:

```txt
About USD 338 to 423 per month
Planning buffer: USD 475 per month
```

### Cost Notes

- The private RDS + SSM tunnel approach does not add a dedicated bastion EC2 or public database cost; it reuses the worker EC2 for the port-forwarding path.
- If Langfuse is disabled or stopped outside active testing, reduce the estimate by roughly USD 20 to 30 per month depending on instance size and retained EBS storage.
- These infrastructure totals do not include variable Gemini Developer API usage, email provider costs, domain registration, WAF, premium support, taxes, or large data-transfer/download spikes. See `UAT_MONTHLY_BILLING_ANALYSIS.md` for the token-based Gemini estimate.

The current repo parameterizes EC2 and RDS sizing through `backend/infra/sizing.ts`. The resource implementations are in:

- `backend/infra/compute-worker.ts`
- `backend/infra/network.ts`
- `backend/infra/compute-langfuse.ts`
- `backend/infra/data.ts`
- `backend/infra/compute-merge-batch.ts`

## UAT Readiness Checks

- Confirm AWS quotas for EC2, Fargate, SQS, Lambda, ECR, CloudFront, and SES.
- Confirm Gemini Developer API request/token quotas before increasing worker concurrency.
- Load test a cutoff burst with queue-depth and oldest-message-age dashboards visible.
- Watch RDS CPU, connections, slow queries, and storage growth.
- Watch worker logs for Gemini throttling, retries, validation/manual-review outcomes, and DLQ messages.
- Restrict `TAXTRACK_LANGFUSE_ACCESS_CIDRS`.
- Keep `TEST_EMAIL_RECIPIENT` set during UAT if reconciliation emails should not reach real customers.

## Sources

- AWS EC2 general purpose instances: https://aws.amazon.com/ec2/instance-types/general-purpose/
- AWS EC2 general purpose specifications: https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html
- AWS RDS DB instance hardware specifications: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.DBInstanceClass.Summary.html
- AWS Fargate task CPU and memory requirements: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html
- AWS public price list API offer files: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json
