# UAT Deployment Troubleshooting Runbook

This runbook documents the UAT deployment and database-access issues encountered while preparing the TaxTrack UAT environment.

UAT uses private RDS, AWS SSM port forwarding for database access, EC2 worker compute, AWS Batch merge compute, and Langfuse. Do not make RDS public and do not use SSH key files for database access.

## Fast UAT Deploy Order

Use this order for a fresh or reset UAT deployment:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:worker
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:merge-worker
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:all
```

`deploy:all` expects required image URIs to already exist. It does not build missing Docker images.

Required image inputs:

```env
WORKER_ECR_REPOSITORY=<worker-ecr-repository-uri>
MERGE_WORKER_ECR_REPOSITORY=<merge-worker-ecr-repository-uri>
```

Script-managed values should be blank or left for the scripts:

```env
TAXTRACK_WORKER_IMAGE_SOURCE_HASH=
TAXTRACK_MERGE_WORKER_IMAGE_SOURCE_HASH=
```

## Issue: Invalid Langfuse CIDR

Symptom:

```txt
"replace-me" is not a valid CIDR block: invalid CIDR address: replace-me
```

Cause:

`TAXTRACK_LANGFUSE_ACCESS_CIDRS` was set to a placeholder. AWS security groups require valid CIDR blocks.

Fix:

Use a real public IP CIDR, or leave the value blank.

```bash
curl https://checkip.amazonaws.com
```

Then set:

```env
TAXTRACK_LANGFUSE_ACCESS_CIDRS=<your-public-ip>/32
```

For temporary open access only when explicitly approved:

```env
TAXTRACK_LANGFUSE_ACCESS_CIDRS=0.0.0.0/0
```

Preferred UAT setting is a restricted `/32` or office CIDR.

## Issue: Session Manager Plugin Missing

Symptom:

```txt
SessionManagerPlugin is not found.
```

Cause:

AWS CLI is installed, but the local AWS Session Manager plugin is missing.

Fix for macOS Apple silicon:

```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac_arm64/session-manager-plugin.pkg" -o "session-manager-plugin.pkg"
sudo installer -pkg session-manager-plugin.pkg -target /
sudo ln -sf /usr/local/sessionmanagerplugin/bin/session-manager-plugin /usr/local/bin/session-manager-plugin
session-manager-plugin
```

Then retry:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm db:tunnel
```

## Issue: SSM Tunnel Uses `replace-me`

Symptom:

```txt
Invalid instance id: replace-me
```

Cause:

The tunnel script received placeholder values for:

```env
TAXTRACK_DB_TUNNEL_INSTANCE_ID
TAXTRACK_DB_TUNNEL_HOST
```

Fix:

Use the latest SST outputs:

```bash
cat backend/infra/.sst/outputs.json
```

Copy:

```txt
workerInstanceId
dbHost
databaseUrl
```

Set:

```env
TAXTRACK_DB_TUNNEL_INSTANCE_ID=<workerInstanceId>
TAXTRACK_DB_TUNNEL_HOST=<dbHost>
TAXTRACK_DB_TUNNEL_LOCAL_PORT=15432
TAXTRACK_DB_TUNNEL_REMOTE_PORT=5432
```

If shell placeholders were exported, clear them:

```bash
unset TAXTRACK_DB_TUNNEL_INSTANCE_ID
unset TAXTRACK_DB_TUNNEL_HOST
```

Important: worker EC2 can be replaced during deploys. If `workerInstanceId` changes, update the env file before starting a new DB tunnel.

## Issue: RDS Password Rejected

Symptom:

```txt
InvalidParameterValue: The parameter MasterUserPassword is not a valid password.
Only printable ASCII characters besides '/', '@', '"', ' ' may be used.
```

Cause:

`TAXTRACK_DB_PASSWORD` contained a character that RDS rejects, commonly `@`.

Valid RDS password rule:

- 8 to 128 characters.
- Printable ASCII only.
- No `/`.
- No `@`.
- No double quote.
- No spaces.

Generate a safe password:

```bash
LC_ALL=C tr -dc 'A-Za-z0-9#%+=:_.-' </dev/urandom | head -c 24; echo
```

Set:

```env
TAXTRACK_DB_PASSWORD=<generated-valid-password>
```

Then redeploy.

## Issue: Missing Merge Worker Image URI

Symptom:

```txt
Error: TAXTRACK_MERGE_WORKER_IMAGE_URI must be set to a real value.
```

Cause:

UAT tried to deploy AWS Batch merge compute before the merge-worker image was built and pushed.

Fix:

Make sure this is set:

```env
MERGE_WORKER_ECR_REPOSITORY=<merge-worker-ecr-repository-uri>
```

Then run:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:merge-worker
```

The script writes these back to `.env.uat`:

```env
TAXTRACK_MERGE_WORKER_IMAGE_URI=<generated-image-uri>
TAXTRACK_MERGE_WORKER_IMAGE_SOURCE_HASH=<generated-source-hash>
```

Then run:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:all
```

## Issue: Uploads Stay Queued

Symptom:

All uploaded PDFs remain in a queued state.

What it usually means:

- The web app is creating SQS messages.
- The worker is not polling the queue, cannot start, or crashes before processing.

Check SQS:

```bash
set -a; source .env.uat; set +a
QUEUE_URL=$(node -e "console.log(require('./backend/infra/.sst/outputs.json').queueUrl)")
DLQ_URL=$(node -e "console.log(require('./backend/infra/.sst/outputs.json').dlqUrl)")

aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names All \
  --region "$AWS_REGION" \
  --query 'Attributes.{Visible:ApproximateNumberOfMessages,NotVisible:ApproximateNumberOfMessagesNotVisible,Delayed:ApproximateNumberOfMessagesDelayed}' \
  --output table

aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names All \
  --region "$AWS_REGION" \
  --query 'Attributes.{Visible:ApproximateNumberOfMessages,NotVisible:ApproximateNumberOfMessagesNotVisible,Delayed:ApproximateNumberOfMessagesDelayed}' \
  --output table
```

If the main queue has visible messages and `NotVisible` stays `0`, the worker is likely not polling.

Check worker EC2 and SSM:

```bash
IID=$(node -e "console.log(require('./backend/infra/.sst/outputs.json').workerInstanceId)")

aws ec2 describe-instance-status \
  --instance-ids "$IID" \
  --include-all-instances \
  --region "$AWS_REGION" \
  --output table

aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=$IID" \
  --region "$AWS_REGION" \
  --output table
```

Check worker service and logs through SSM:

```bash
IID=$(node -e "console.log(require('./backend/infra/.sst/outputs.json').workerInstanceId)")

CMD_ID=$(aws ssm send-command \
  --instance-ids "$IID" \
  --document-name AWS-RunShellScript \
  --comment 'TaxTrack worker health check' \
  --parameters commands='[
    "echo TAXTRACK_WORKER_SERVICE=$(systemctl is-active taxtrack-worker || true)",
    "systemctl show taxtrack-worker -p ActiveState -p SubState -p Result -p NRestarts --no-pager || true",
    "sudo docker ps -a --filter name=taxtrack-worker --format \"table {{.Names}}\\t{{.Status}}\\t{{.Image}}\" || true",
    "sudo docker logs --tail 160 taxtrack-worker 2>&1 | sed -E \"s#(postgresql://[^:]+:)[^@]+@#\\1<redacted>@#; s/(KEY|TOKEN|PASSWORD|SECRET)=([^[:space:]]+)/\\1=<redacted>/g\" || true"
  ]' \
  --region "$AWS_REGION" \
  --query 'Command.CommandId' \
  --output text)

sleep 5

aws ssm get-command-invocation \
  --command-id "$CMD_ID" \
  --instance-id "$IID" \
  --region "$AWS_REGION" \
  --output json
```

Known causes encountered:

- Systemd rejected `DATABASE_URL` because URL-encoded passwords contain `%`. The fix is to escape `%` as `%%` in EC2 systemd unit values, then redeploy the worker.
- Worker exits at startup when Gemini is selected without `GEMINI_API_KEY`.

For the UAT Gemini agentic extractor, use:

```env
GEMINI_API_KEY=<gemini-developer-api-key>
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
```

The worker sends the original PDF once and retries timeouts and HTTP 429/500/502/503/504 twice. Repeated failures persist a `failed` document envelope with safe reason and attempt telemetry; no raw response or transcript is stored.

After changing worker env values:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:worker
```

Then confirm:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm db:tunnel
```

or use SQS attributes to confirm the main queue is draining.

## Issue: `sst diff --stage uat` Says Stage Not Found

Symptom:

```txt
Stage not found
```

Cause:

There is no existing deployed `uat` stage to diff against.

Fix:

Run the initial deploy instead:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm deploy:all
```

After the first successful deploy, future diffs can compare against the existing stage.

## Deployed Database Access Checklist

Use the private SSM tunnel:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm db:tunnel
```

pgAdmin settings:

```txt
Host: localhost
Port: 15432
Database: taxtrack
Username: taxtrack
Password: from databaseUrl or TAXTRACK_DB_PASSWORD
SSL mode: Require
```

See also:

```txt
DEPLOYED_DATABASE_ACCESS.md
```

## Security Notes

- Do not commit `.env.uat` after real secrets are added.
- Do not paste secrets into docs, PRs, tickets, or chat.
- Do not make RDS public for pgAdmin.
- Use SSM Session Manager through the worker EC2 or another approved SSM-enabled instance in the same VPC path.
- Restrict `TAXTRACK_LANGFUSE_ACCESS_CIDRS` to approved IPs.
