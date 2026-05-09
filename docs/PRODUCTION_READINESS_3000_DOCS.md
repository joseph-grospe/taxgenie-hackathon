# TaxTrack Production Readiness for 3,000 Documents per Month

## Summary

TaxTrack is expected to process around 3,000 uploaded 2307 documents per month. The average volume is manageable, but the system should be prepared for burst uploads near cutoff periods, large reconciliation runs, signing batches, PDF merge jobs, dashboard usage, and possible abusive traffic.

Production readiness should focus on five areas:

- Stable infrastructure sizing.
- Protection against cost-amplifying endpoints.
- Queue and worker throughput.
- Database performance.
- Operational monitoring and incident controls.

## Workload Assumptions

- Estimated upload volume: 3,000 documents per month.
- Estimated yearly upload volume: 36,000 documents per year.
- Average daily upload volume: about 100 documents per day.
- Burst scenario: 1,000 to 3,000 documents uploaded in a short period.
- Uploads go directly from the browser to S3 using presigned URLs.
- The app creates one asynchronous queue message per uploaded document.
- Workers process documents through OCR, AI normalization, validation, duplicate checking, and persistence.
- Dashboard, reconciliation, signing, and merge workflows all read from or write to Postgres.

## Recommended Production Resources

| Area | Recommended Resource |
| --- | --- |
| Web/API app | ECS Fargate or App Runner, 1 vCPU / 2 GB, minimum 2 instances or tasks, maximum 4 |
| Async document worker | ECS Fargate, 1 vCPU / 2 GB per worker task, minimum 1 to 2 tasks, maximum 8 to 10 tasks |
| Heavy PDF/signing worker | Separate Fargate task, 2 vCPU / 4 GB, scale to 2 to 4 tasks when needed |
| PDF merge jobs | AWS Batch on Fargate, 2 vCPU / 4 GB per job |
| Large PDF merge jobs | AWS Batch on Fargate, 4 vCPU / 8 GB when file size or page count is high |
| Database | Amazon RDS PostgreSQL db.m7g.large, 2 vCPU / 8 GB |
| Database storage | RDS gp3 storage, start at 100 GB with autoscaling enabled |
| Queue | Amazon SQS Standard queue plus DLQ |
| Object storage | One S3 storage bucket with entity-scoped prefixes |
| Load balancer | Application Load Balancer if using ECS |
| Observability | CloudWatch metrics, logs, alarms, and slow-query visibility |

## Cost-Sensitive Alternative

If the team needs to reduce initial cost:

| Area | Cost-Sensitive Resource |
| --- | --- |
| Database | Amazon RDS PostgreSQL db.t4g.medium, 2 vCPU / 4 GB |
| Deployment | Single-AZ for non-critical or early production environments |

This lowers cost but reduces availability and failover protection. Upgrade to db.m7g.large if dashboard latency, reconciliation imports, worker writes, or database CPU become noisy.

## Estimated Monthly Cost

The estimate below assumes AWS Singapore, ap-southeast-1.

| Item | Estimated Monthly Cost |
| --- | ---: |
| Web/API: 2 ECS Fargate ARM tasks, 1 vCPU / 2 GB | ~USD 72 |
| Async workers: 2 always-on Fargate ARM tasks, 1 vCPU / 2 GB | ~USD 72 |
| Burst workers, signing, and merge jobs | ~USD 10 to 40 |
| RDS PostgreSQL db.m7g.large, Multi-AZ | ~USD 342 |
| RDS gp3 storage, 100 GB Multi-AZ | ~USD 28 |
| Application Load Balancer | ~USD 24 to 35 |
| S3 storage and artifacts | ~USD 3 to 15 |
| SQS plus DLQ | Less than USD 1 |
| CloudWatch logs, metrics, and alarms | ~USD 15 to 50 |
| NAT Gateway and VPC networking, if using private subnets | ~USD 45 to 110+ |

Expected stable production total:

```txt
AWS Singapore stable setup: around USD 610 to 760 per month
```

Recommended planning budget:

```txt
AWS infrastructure: USD 700 per month
Buffer: USD 200 per month
Total planning budget: USD 900 per month
```

This estimate does not include Azure Document Intelligence, Azure OpenAI/OpenAI, email provider costs, domain registration, third-party observability, WAF add-ons, premium support, or unusually high data transfer.

## Primary Bottlenecks

### Worker Throughput

Each uploaded document becomes an asynchronous processing job. If worker concurrency is too low, SQS queue age will grow quickly during cutoff uploads.

Monitor:

- SQS visible messages.
- Oldest message age.
- Worker jobs completed per minute.
- Worker failure count.
- DLQ count.

### OCR and AI Provider Limits

OCR and AI calls are likely the slowest and most expensive parts of the pipeline.

Monitor:

- OCR request duration.
- OCR throttling.
- AI request duration.
- AI rate-limit responses.
- Cost per document.

### Reconciliation Matching

Reconciliation files may contain many rows and can be heavier than the uploaded certificate count.

Monitor:

- Reconciliation import duration.
- Rows per reconciliation file.
- Matching query duration.
- Database slow queries.

### Dashboard and Operational Reads

Monthly dashboard views are expected to be manageable, but yearly views may query 36,000+ documents plus reconciliation rows and artifacts.

Monitor:

- Dashboard API p95 latency.
- Active dashboard users.
- Query plans for monthly, quarterly, and yearly filters.
- Database CPU and connections.

### PDF Signing and Merge Jobs

PDF workflows can cause CPU and memory spikes.

Monitor:

- Signing duration.
- Signing memory usage.
- Merge job queue time.
- Merge job duration.
- Merge job failures.

## DDoS and Abuse Cost Risks

The biggest DDoS-related bill risks are:

| Service | Cost Risk |
| --- | --- |
| CloudFront / data transfer | Large response traffic or downloads can increase data transfer cost |
| Application Load Balancer | HTTP floods can increase LCU charges |
| AWS WAF | WAF charges per Web ACL, rule, and request inspected |
| ECS Fargate or App Runner | Autoscaling can add compute cost during attack traffic |
| CloudWatch Logs | Noisy request/error logging can become expensive |
| NAT Gateway | Private subnet outbound traffic can create data processing cost |
| S3 | Abusive upload/download traffic can increase request, storage, and transfer cost |
| SQS and workers | Fake uploads can create queue messages and worker jobs |
| OCR and AI providers | Fake uploads can trigger the most expensive downstream processing |

The highest business risk is:

```txt
Fake uploads -> SQS jobs -> workers -> OCR / AI processing
```

The system must prevent unauthenticated or excessive authenticated traffic from triggering this chain.

## AWS WAF Recommendation

AWS WAF is recommended for production. It is not free, but the normal cost is small compared with allowing attack traffic to reach ALB, ECS/App Runner, RDS, S3, SQS, workers, OCR, and AI.

Typical AWS WAF charges:

| Charge | Example Cost |
| --- | ---: |
| Web ACL | ~USD 5 per month each |
| Rule | ~USD 1 per month each |
| Request inspection | ~USD 0.60 per 1 million requests |
| Managed rule group | Usually counts like a rule, but Marketplace rules can add more |
| Bot Control / Fraud Control | Extra monthly and request-based charges |
| CAPTCHA / Challenge | Extra per attempt or response |
| Extra WCU/body inspection | Extra request-based charges |

Example simple WAF setup:

```txt
1 Web ACL
10 rules or managed rule groups
10 million requests per month
```

Estimated WAF cost:

```txt
USD 5 Web ACL
USD 10 rules
USD 6 request inspection
Total: around USD 21 per month
```

Example attack traffic:

```txt
100 million attack requests x USD 0.60 per million
= around USD 60 in WAF request charges
```

This is usually acceptable because blocking at WAF can prevent much larger downstream costs.

Avoid these at first unless needed:

- AWS Shield Advanced, which is about USD 3,000 per month with commitment.
- WAF Bot Control.
- WAF Fraud Control.
- Third-party Marketplace rules.
- Very noisy full WAF logging.

Recommended initial WAF setup:

- AWS Managed Common Rule Set.
- AWS IP Reputation List.
- Rate-based rule for all traffic.
- Stricter rate rule for `/api/auth/*`.
- Stricter rate rule for `/api/uploads/presign`.
- Stricter rate rule for `/api/uploads/complete`.
- Stricter rate rule for signed PDF, merge output, and export downloads.
- Sampled WAF logging rather than logging every request during normal operation.

## Rate Limit Placement

Rate limits should exist at multiple layers.

Recommended request path:

```txt
Internet
  -> CloudFront
  -> AWS WAF rate-based rules
  -> ALB / App Runner / web runtime
  -> App route-level rate limits
  -> Business quota checks before S3 presign and SQS queue
  -> Worker concurrency limits
  -> OCR / AI provider quota limits
```

## Highest Priority Endpoints to Protect

| Endpoint | Reason |
| --- | --- |
| `POST /api/uploads/presign` | Can create S3 upload permissions |
| `POST /api/uploads/complete` | Can enqueue SQS jobs and trigger workers |
| `POST /api/uploads/batches/active/close` | Can affect batch state |
| `GET /api/dashboard/summary` | Can create repeated DB read pressure |
| `GET /api/documents/:docId/signed-pdf` | Can create app/S3 download traffic |
| `POST /api/uploads/batches/:batchId/sign` | Can trigger CPU-heavy PDF signing |
| `POST /api/merge-jobs` | Can submit AWS Batch merge work |
| `POST /api/merge-jobs/preview` | Can trigger expensive preview queries |
| `GET /api/merge-jobs/:jobId/outputs/:partNumber` | Can create output download traffic |
| Export endpoints | Can trigger CPU/memory-heavy workbook generation |
| Import endpoints | Can parse large files and write many DB rows |
| Login/session endpoints | Common target for brute-force and credential stuffing |

## App-Level Rate Limit Policies

Suggested starting policies:

| Scope | Starting Limit |
| --- | --- |
| Auth/login | 20 requests per 5 minutes per IP |
| Upload presign | 30 requests per minute per user |
| Upload complete | 120 requests per minute per user |
| Dashboard summary | 120 requests per minute per user |
| Signed PDF/downloads | 60 requests per minute per user |
| Exports | 10 requests per 5 minutes per user |
| Signing | 5 requests per 10 minutes per user |
| Merge create | 5 requests per 10 minutes per user |
| Imports | 5 requests per 10 minutes per user |

Use user ID when authenticated and IP address as a fallback. In production, app-level rate limits should use a shared store such as Redis or Valkey. Do not rely on in-memory counters when more than one app instance is running.

## Business Quotas

Business quotas should prevent valid users from creating excessive downstream work.

Recommended upload quotas:

- Maximum files per batch.
- Maximum file size per file.
- Maximum total batch size.
- Maximum new batches per user per hour/day.
- Maximum pending, queued, or processing documents per user.
- Maximum pending, queued, or processing documents globally.

Recommended processing quotas:

- Maximum active worker jobs.
- Maximum OCR calls per minute.
- Maximum AI calls per minute.
- Maximum signing jobs per user per time window.
- Maximum merge jobs per user per time window.

## Required Code Changes

### Infra

Add WAF infrastructure:

```txt
backend/infra/waf.ts
```

Wire WAF to the public web entrypoint in:

```txt
backend/infra/webapp.ts
```

Add shared rate-limit state:

```txt
backend/infra/rate-limit-cache.ts
```

Expose environment variables:

```txt
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REDIS_URL=...
```

### App

Add a shared server-side rate limiter:

```txt
webapp/tax-track/src/lib/rate-limit-server.ts
```

Add upload/business quota checks:

```txt
webapp/tax-track/src/lib/upload-quota-server.ts
```

Update high-cost API routes first:

```txt
webapp/tax-track/src/routes/api/uploads/presign.ts
webapp/tax-track/src/routes/api/uploads/complete.ts
webapp/tax-track/src/routes/api/dashboard/summary.ts
webapp/tax-track/src/routes/api/documents.$docId.signed-pdf.ts
webapp/tax-track/src/routes/api/merge-jobs.ts
webapp/tax-track/src/routes/api/merge-jobs/preview.ts
webapp/tax-track/src/routes/api/merge-jobs.$jobId.outputs.$partNumber.ts
webapp/tax-track/src/routes/api/uploads/batches.$batchId.sign.ts
webapp/tax-track/src/routes/api/uploads/batches.$batchId.bir2307.export.ts
webapp/tax-track/src/routes/api/uploads/batches.$batchId.reconciliation.export.ts
webapp/tax-track/src/routes/api/reconciliation/import.ts
webapp/tax-track/src/routes/api/reconciliation/export.ts
webapp/tax-track/src/routes/api/masterlist/import.ts
webapp/tax-track/src/routes/api/entities/import.ts
webapp/tax-track/src/routes/api/s3-object.ts
```

For upload and import routes, apply rate limits before reading large request bodies.

## Monitoring and Alarms

Minimum production alarms:

- SQS visible message count.
- SQS oldest message age.
- DLQ message count.
- Worker error rate.
- OCR/AI throttling.
- OCR/AI request latency.
- Dashboard API p95 latency.
- RDS CPU.
- RDS connections.
- RDS storage usage.
- RDS slow queries.
- ALB 4xx and 5xx rate.
- WAF blocked request count.
- CloudWatch log ingestion volume.
- NAT data processing volume.
- S3 request count and data transfer.
- Monthly AWS budget threshold.
- Monthly OCR/AI provider budget threshold.

## Scale-Up Triggers

| Symptom | Recommended Action |
| --- | --- |
| SQS oldest message age keeps rising | Increase maximum worker tasks |
| OCR or AI requests are throttled | Increase external provider quota before adding more workers |
| RDS CPU stays above 60% to 70% during normal use | Upgrade to db.m7g.xlarge |
| RDS connections approach the limit | Add pooling, reduce worker concurrency, or tune pool sizes |
| Dashboard API p95 latency exceeds 1 second | Add caching or aggregate tables |
| PDF signing runs out of memory | Move signing to 2 vCPU / 4 to 8 GB tasks |
| Merge jobs fail on large PDFs | Use 4 vCPU / 8 GB merge jobs |
| NAT Gateway cost grows unexpectedly | Add VPC endpoints for S3 and supported AWS services |
| WAF request cost spikes | Tighten rate-based rules and reduce noisy logging |

## Launch Checklist

- Production database is RDS PostgreSQL db.m7g.large or explicitly approved alternative.
- RDS backups are enabled.
- RDS slow-query visibility is enabled.
- Dashboard performance indexes are applied.
- SQS queue and DLQ are configured.
- Worker concurrency and autoscaling policy are defined.
- OCR and AI provider quotas are confirmed.
- WAF is configured on the public app entrypoint.
- High-cost API endpoints have app-level rate limits.
- Upload business quotas are enforced before SQS queueing.
- Large imports and exports are protected by rate limits.
- Signing and merge jobs do not run inside the main web request path.
- CloudWatch alarms are configured.
- AWS Budget alerts are configured.
- OCR/AI provider budget alerts are configured.
- Burst test with realistic document volume has been completed.
- Incident runbook exists for queue backlog, OCR/AI throttling, and DDoS/cost spike events.

## Practical Readiness Position

TaxTrack can be stable at 3,000 documents per month, but production readiness depends on handling burst behavior safely. The system should not be considered fully production-ready until WAF/rate limits, upload quotas, queue monitoring, provider quota validation, database monitoring, and budget alarms are in place.
