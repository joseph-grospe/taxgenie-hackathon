# TaxTrack Production Resource Recommendation for 3,000 Documents per Month

## Summary

TaxTrack is expected to process around 3,000 uploaded 2307 documents per month. The average load is modest, but production sizing should be based on burst stability because uploads may happen near cutoff dates or in large batches.

This recommendation favors a stable AWS setup that can handle regular dashboard usage, asynchronous document processing, reconciliation, signing, and PDF merge workflows without overbuilding the platform.

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
| Object storage | S3 source bucket plus S3 artifact bucket |
| Load balancer | Application Load Balancer if using ECS |
| Observability | CloudWatch metrics, logs, alarms, and slow-query visibility |

## Cost-Sensitive Alternative

If the team needs to reduce the initial infrastructure cost, the database can start on:

| Area | Cost-Sensitive Resource |
| --- | --- |
| Database | Amazon RDS PostgreSQL db.t4g.medium, 2 vCPU / 4 GB |
| Deployment | Single-AZ for non-critical or early production environments |

This is cheaper, but it has less memory and less headroom. Upgrade to db.m7g.large if dashboard latency, reconciliation imports, worker writes, or database CPU become noisy.

## Database Recommendation

Use Amazon RDS PostgreSQL db.m7g.large for production stability.

Reasons:

- The database is shared by uploads, workers, dashboard, reconciliation, signing, merge tracking, and downloads.
- 8 GB memory gives more room for indexes, query planning, and concurrent reads.
- It avoids relying on burstable CPU credits for normal production behavior.
- It gives a cleaner path to db.m7g.xlarge if the workload grows.

Recommended starting configuration:

- Instance class: db.m7g.large.
- Deployment: Multi-AZ for production.
- Storage: gp3.
- Starting storage: 100 GB.
- Storage autoscaling: enabled.
- Backups: enabled.
- Slow query logging: enabled.
- Performance monitoring: enabled if available in the deployment budget.

## Worker Recommendation

Start with asynchronous document workers sized as:

```txt
worker task: 1 vCPU / 2 GB
minimum tasks: 1 to 2
maximum tasks: 8 to 10
scale on: SQS visible messages and oldest message age
```

This gives the system room to process cutoff-period bursts without keeping all workers running 24/7.

If one document takes around 2 to 3 minutes to process, 8 to 10 workers should be a reasonable starting point for clearing a large batch over several hours, assuming OCR and AI service quotas allow it.

## Web/API Recommendation

Run the web/API layer separately from the worker layer.

Recommended starting configuration:

```txt
web task: 1 vCPU / 2 GB
minimum tasks: 2
maximum tasks: 4
scale on: CPU, memory, request count, or target response time
```

The web/API process should handle authentication, dashboard APIs, upload presign requests, upload completion, queue submission, and operational views. It should not perform heavy PDF signing, large exports, or long-running merge work inline.

## Signing and Merge Recommendation

Keep signing and merge work outside the normal web/API process.

Recommended signing worker:

```txt
signing task: 2 vCPU / 4 GB
scale to: 2 to 4 tasks when needed
```

Recommended merge jobs:

```txt
normal merge job: 2 vCPU / 4 GB
large merge job: 4 vCPU / 8 GB
```

This protects the user-facing app from CPU and memory spikes caused by PDF manipulation.

## Queue Recommendation

Use Amazon SQS Standard queue plus a dead-letter queue.

Recommended monitoring:

- Approximate number of visible messages.
- Approximate age of oldest message.
- Number of messages sent.
- Number of messages received.
- Number of messages deleted.
- DLQ message count.
- Worker retry count.

Recommended scaling signal:

- Scale workers out when visible messages or oldest message age increases.
- Scale workers in only after the queue is stable.

## Storage Recommendation

Use separate S3 buckets or clearly separated prefixes for:

- Raw uploaded source files.
- Intermediate extraction artifacts.
- Signed PDFs.
- Merged PDF outputs.
- Export files.

Recommended policies:

- Enable encryption.
- Enable lifecycle rules for temporary and intermediate artifacts.
- Keep source documents and signed outputs according to business retention requirements.
- Prefer presigned S3 download URLs for large artifacts where possible.

## Estimated Monthly Cost

The estimate below assumes AWS Singapore, ap-southeast-1, because that is the closest common AWS region for a Philippines-based deployment. Actual costs may change based on region, data transfer, log volume, worker burst duration, database deployment mode, and provider pricing.

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

## Cost-Sensitive Monthly Estimate

If using Single-AZ RDS instead of Multi-AZ:

```txt
AWS Singapore cost-sensitive setup: around USD 400 to 550 per month
```

This lowers cost but reduces availability and failover protection.

## US East Cost Comparison

If deployed in US East, costs are typically lower:

```txt
US East stable setup: around USD 480 to 620 per month
```

This may not be the best region for latency or data residency, but it is useful as a pricing comparison.

## Costs Not Included

This estimate does not include:

- Azure Document Intelligence or OCR usage.
- Azure OpenAI or OpenAI usage.
- Email provider costs.
- Domain registration.
- Third-party observability tools.
- WAF.
- Premium support.
- Data transfer spikes from large downloads.
- Extra backup retention beyond the default plan.

These may become significant depending on document page count, AI token usage, artifact size, and operational logging volume.

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

## Practical Recommendation

For a stable production launch, start with:

```txt
Web/API: 2 x 1 vCPU / 2 GB
Workers: 2 x 1 vCPU / 2 GB, autoscale up to 8 to 10
Signing: separate 2 vCPU / 4 GB task
Merge: AWS Batch Fargate, 2 vCPU / 4 GB default
Database: RDS PostgreSQL db.m7g.large Multi-AZ
Storage: RDS gp3 100 GB with autoscaling
Queue: SQS Standard plus DLQ
Budget: USD 900/month planning number
```

This setup is intentionally conservative. It gives the team room to handle burst uploads, dashboard usage, reconciliation, and PDF workflows without paying for a large always-on worker fleet.
