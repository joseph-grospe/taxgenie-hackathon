# Near-zero hackathon deployment

The `hackathon` Pulumi profile is a judging environment that uses Neon Free
PostgreSQL and GCP serverless services in Singapore. It is separate from the
default `production` profile and does not create Cloud SQL, load balancing,
Cloud DNS, certificates, or Monitoring alert policies.

## Cost boundary

The stack scales both Cloud Run services to zero and caps each at one instance.
The queue dispatches one extraction at a time. The private, versioned GCS bucket
deletes objects and noncurrent versions after 40 days, and Artifact Registry
retains only the latest image versions. Merge, email, and purge stay disabled.
The project-selected Cloud Build runner receives the standard Cloud Build
builder role so it can read staged source archives and push image digests.

Before deploying:

1. Create a GCP billing budget of **$5** for the hackathon project. A budget is
   an alert, not a hard cap; disabling billing can also stop the demo and may
   not stop already-incurred charges.
2. Review Cloud Run and Cloud Tasks project quotas. The Pulumi max-instance and
   queue-concurrency settings are the operational spend limits for this stack.
3. Use a Gemini Developer API key on the available free tier and set the
   smallest project/API quota that still supports the demo. Gemini quota and
   billing controls are managed outside Pulumi.
4. Keep only synthetic judging PDFs in this environment.

The expected judging cost is $0–$1 at light traffic, but quotas and budgets do
not guarantee a final bill. Check the GCP Billing report and Gemini usage after
every rehearsal.

## 1. Create Neon

In the [Neon console](https://console.neon.tech), create a Free project in the
AWS Singapore region using PostgreSQL 17. Create:

- database: `taxgenie`
- application role: `taxgenie_app`

Copy both connection strings from Neon:

- pooled URL for the web and worker (`databaseUrl`)
- direct URL for migrations (`migrationDatabaseUrl`)

Both values must include TLS parameters. They are encrypted Pulumi inputs and
are mounted only as `DATABASE_URL` in their intended runtime. The application
removes URL-level TLS options and configures node-postgres with certificate
verification and channel binding. It does not log or export either URL.
Supabase can be evaluated later through the same connection-string interface;
this profile contains no Neon-specific application SDK.

## 2. Authenticate and configure the stack

Prerequisites are Node.js, pnpm, Docker, the Pulumi CLI, an authenticated
`gcloud` CLI, and a configured Pulumi state backend.

```bash
gcloud auth login
gcloud auth application-default login
export GCP_PROJECT_ID=<hackathon-project-id>
export GCP_REGION=asia-southeast1
export PULUMI_STACK=hackathon

cd backend/infra-gcp
pulumi stack init hackathon # omit when the stack already exists
pulumi config set gcp:project "$GCP_PROJECT_ID"
pulumi config set deploymentProfile hackathon
pulumi config set region "$GCP_REGION"
pulumi config set --secret geminiApiKey '<gemini-key>'
pulumi config set --secret langsmithApiKey
pulumi config set langsmithProject taxgenie-hackathon
pulumi config set --secret betterAuthSecret '<32+-character-random-secret>'
pulumi config set --secret databaseUrl '<pooled-neon-url>'
pulumi config set --secret migrationDatabaseUrl '<direct-neon-url>'
pulumi config set --secret seedEmail '<administrator-email>'
pulumi config set --secret seedPassword '<administrator-password>'
cd ../..
```

Never put real values into `Pulumi.hackathon.yaml.example`, shell history,
commits, logs, or stack outputs.

## 3. Deploy

Run each stage independently while diagnosing deployment issues:

```bash
pnpm deploy:hackathon:bootstrap
pnpm deploy:hackathon:images
pnpm deploy:hackathon:preview
pnpm deploy:hackathon:infra
pnpm deploy:hackathon:migrate

export TAXGENIE_SEED_EMAIL='<same administrator email>'
export TAXGENIE_SEED_PASSWORD='<same administrator password>'
pnpm deploy:hackathon:smoke
```

`deploy:hackathon:preview` rejects Cloud SQL, Compute/load-balancer, DNS,
Certificate Manager, and Monitoring alert resources. It expects the service
images, so run it after the image stage. The preview command selects the
hackathon profile and enables service resources in configuration, but does not
apply them. The migration command resolves the job from Pulumi outputs; the
smoke test resolves the service URLs and bucket name. It verifies the public web
health endpoint, rejected unauthenticated worker call, private bucket IAM, and
seeded administrator sign-in.

Once the individual stages are known to work, the complete flow is:

```bash
pnpm deploy:hackathon:all
```

The full command requires the two `TAXGENIE_SEED_*` variables for its final
sign-in check. The live acceptance test still requires uploading a synthetic
PDF and capturing Cloud Run, Cloud Tasks, GCS generation, Neon, and Gemini
telemetry for the demo.

## 4. Teardown after judging

Keep this environment only through October 1, 2026. After the judging window,
verify that the selected Pulumi stack is exactly `hackathon`; never run these
commands against `prod` or the retained AWS stack.

```bash
pulumi --cwd backend/infra-gcp stack select hackathon
pulumi --cwd backend/infra-gcp destroy --stack hackathon
```

Then delete the Neon hackathon project in the Neon console. The hackathon GCS
bucket is configured for profile-scoped force deletion so its synthetic objects
do not block teardown. This does not migrate or delete production/AWS data.
