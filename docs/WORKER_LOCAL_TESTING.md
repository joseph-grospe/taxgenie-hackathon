# Local Async Worker Testing Guide

Use this guide to verify the worker pipeline end-to-end against AWS SQS without affecting production queue traffic.

## Why this setup

- Keep test runs isolated from production `SQS_QUEUE_URL`.
- Validate the full path: `S3 upload -> SQS message -> Worker -> DB/S3 artifacts`.
- Use the same production worker code path, with only queue and source object values changed.

## 1) Resolve `WORKER_TEST_QUEUE_URL` and `WORKER_TEST_S3_BUCKET`

You can get these from your existing SST outputs or AWS directly.

### 1A) From SST output

Deploy first (or redeploy) your target stage and read the output keys.

```bash
AWS_PROFILE=mac-bacon-profile \
TAXTRACK_INFRA_SCOPE=backend \
SST_STAGE=dev \
pnpm deploy:backend
```

In the deploy output, pick:

- `queueUrl` → set `WORKER_TEST_QUEUE_URL`
- `artifactsBucket` or `sourceFilesBucket` → set `WORKER_TEST_S3_BUCKET`
- With `TAXTRACK_INFRA_SCOPE=backend` this resolves to stage `dev-backend`, so default resource names are `taxtrack-events-dev-backend`, `taxtrack-dev-backend-source-files`, and `taxtrack-dev-backend-artifacts`.

If you prefer, run infra directly:

```bash
AWS_PROFILE=mac-bacon-profile \
TAXTRACK_INFRA_SCOPE=backend \
SST_STAGE=dev-backend \
pnpm --filter @taxtrack/infra exec sst deploy --stage dev-backend
```

If you keep `SST_STAGE=dev` and `TAXTRACK_INFRA_SCOPE=backend`, the deploy script still succeeds, but output values are for the `dev-backend` stage.

To export only the two values from output, add:

```bash
export WORKER_TEST_S3_BUCKET=<sourceFilesBucket-or-artifactsBucket from output>
export WORKER_TEST_QUEUE_URL=<queueUrl from output>
```

### 1B) From AWS CLI

```bash
export AWS_PROFILE=mac-bacon-profile
export AWS_REGION=ap-southeast-1

# main queue URL (dev stage default naming)
aws sqs get-queue-url \
  --queue-name taxtrack-events-dev-backend \
  --region "$AWS_REGION" \
  --query QueueUrl \
  --output text

# test queue if you created a separate one
aws sqs get-queue-url \
  --queue-name taxtrack-events-worker-test-dev \
  --region "$AWS_REGION" \
  --query QueueUrl \
  --output text

# bucket names
aws s3api list-buckets \
  --query "Buckets[].Name" \
  --output text | tr '\t' '\n' | rg "^taxtrack-dev-backend.*(artifacts|source-files)"
```

Then:

```bash
export WORKER_TEST_S3_BUCKET=<bucket-from-output-or-cli>
export WORKER_TEST_QUEUE_URL=<queue-url-from-output-or-cli>
```

You can also keep using one queue and just set:

- `WORKER_TEST_QUEUE_URL=$SQS_QUEUE_URL`
- `WORKER_TEST_S3_BUCKET=$S3_BUCKET`

## 2) Setup a test queue (recommended)

You can either:

- create a dedicated test queue in AWS (`taxtrack-events-worker-test`), or
- keep using your main queue in local/dev until you are ready for isolation.

If you create one:

```bash
aws sqs create-queue --queue-name taxtrack-events-worker-test-dev
aws sqs create-queue --queue-name taxtrack-events-worker-test-dev-dlq
```

Capture the test queue URL:

- `WORKER_TEST_QUEUE_URL=...`
- (optional) `WORKER_TEST_DLQ_URL=...`

## 3) Prepare env for local testing

Use a separate env file or override the existing one:

```bash
WORKER_TEST_S3_BUCKET=<your-s3-bucket-for-test-uploads>
WORKER_TEST_QUEUE_URL=<your-test-sqs-queue-url>
AWS_REGION=ap-southeast-1
AWS_PROFILE=<your-aws-profile>
```

If you want to keep the existing worker env values untouched, set:

```bash
S3_BUCKET=<source-or-artifact-bucket>
SQS_QUEUE_URL=<your-test-sqs-queue-url>
```

## 4) Start the worker against the test queue

```bash
pnpm --filter @taxtrack/worker dev
```

The worker now loads root `.env` automatically at startup, so no `set -a`/`source` step is required.
If you need to override values at invocation time, pass standard env assignments before `pnpm`.

## 5) Upload a file + enqueue test message (CLI helper)

Use this helper script to trigger the worker exactly like production queue payloads:

```bash
pnpm --filter @taxtrack/worker dev:emit-test-event \
  --file ./path/to/sample.pdf \
  --bucket "$WORKER_TEST_S3_BUCKET" \
  --queue-url "$WORKER_TEST_QUEUE_URL" \
  --source-file-id "sample-local-doc-001" \
  --revision "1" \
  --mime-type "application/pdf" \
  --prefix "worker-local-test"
```

Or from repo root:

```bash
pnpm dev:worker:test-event -- \
  --file ./path/to/sample.pdf \
  --source-file-id "sample-local-doc-001" \
  --revision "1" \
  --mime-type "application/pdf" \
  --prefix "worker-local-test"
```

`--bucket` and `--queue-url` are optional when the root `.env` defines `WORKER_TEST_S3_BUCKET`
and `WORKER_TEST_QUEUE_URL`.

Optional flags:

- `--event-id` custom event id
- `--trace-id` custom trace id
- `--region` explicit AWS region
- `--profile` explicit AWS profile
- `--dry-run` print payload only (no upload or queue send)

The command uploads the file to:

- `s3://<bucket>/<prefix>/<source-file-id>/<revision>/<filename>`

Then it sends a message body:

```json
{ "event": { "version":"v1", "source":"google-drive", ... } }
```

## 6) Confirm worker was executed

Check the logs and table state:

```sql
SELECT job_id, event_id, status, attempts, started_at, finished_at
FROM worker_jobs
ORDER BY created_at DESC
LIMIT 10;
```

```sql
SELECT job_id, source_file_id, revision, validation, artifact_key
FROM document_results
ORDER BY created_at DESC
LIMIT 10;
```

And confirm output object exists in S3 at the generated key path.

## 7) Optional secure HTTP test path (future step)

If you want the exact “attach file > save to S3 > queue message” API UX:

1. Create a tiny dev-only API (Lambda/API Gateway or local route).
2. Add a token guard (`x-dev-token`) and keep it behind your test stack only.
3. In handler, reuse the same payload contract above and publish to the test queue.

The CLI above is the fastest way to validate the worker behavior now.
