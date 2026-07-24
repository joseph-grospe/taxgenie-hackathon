# Production Environment Proposal for 8,000 BIR 2307 Certificates per Month

## Summary

This document proposes a production AWS environment for TaxTrack sized for about 8,000 BIR 2307 certificates per month.

The recommended production target keeps the database private, uses AWS SSM Session Manager for controlled database access, and moves the extraction worker path toward horizontally scalable compute. The current repository can run a smaller production shape today, but the target production design below adds high availability, safer operations, and cost headroom for month-end spikes.

Estimated monthly AWS cost for the recommended production target in `ap-southeast-1` is about **USD 715 to USD 1,175 per month**, with **USD 1,400 per month** as a planning buffer. This excludes Azure AI/OpenAI/Document Intelligence usage, taxes, support plans, and unusually high outbound data transfer.

## Workload Assumptions

| Item | Planning Assumption |
| --- | --- |
| Monthly certificate volume | 8,000 BIR 2307 certificates |
| Average daily volume | About 267 certificates per day |
| Peak behavior | Month-end and filing-window bursts can be several times the daily average |
| Primary workload | Upload, OCR/extraction, review, merge/export, audit trail |
| Availability target | Production should tolerate an Availability Zone failure for the database layer |
| Database access | Private RDS only; pgAdmin access through SSM port forwarding |
| Region used for estimate | AWS Asia Pacific Singapore, `ap-southeast-1` |
| Estimate date | May 11, 2026 |

## Proposed Production Resources

| Area | Proposed Production Resource | Notes |
| --- | --- | --- |
| AWS account/stage | Dedicated production AWS account or isolated `prod` stage | Do not share production state with UAT or developer stages. |
| Deployment profile | `TAXTRACK_INFRA_PROFILE=full`, `TAXTRACK_INFRA_SCOPE=all`, `STAGE=prod` | Keeps web, backend, worker, database, Batch, and supporting services together. |
| Network | VPC across at least 2 Availability Zones | Public subnets for public entry points; private subnets for RDS and internal services. |
| NAT/private egress | Prefer managed NAT Gateway for production; cost-sensitive option can keep NAT EC2 | Managed NAT is more operationally reliable; NAT EC2 is cheaper but needs patching and recovery handling. |
| Database | Amazon RDS PostgreSQL `db.m7g.large`, Multi-AZ, private, 100 GB gp3 | Recommended baseline for production reliability and safer peak behavior. |
| Database storage | gp3, 100 GB initial, autoscale to at least 500 GB | Enable encryption, backups, PITR, and storage autoscaling. |
| Database access | SSM port forwarding through worker or another SSM-enabled EC2 in the same VPC path | Operators connect pgAdmin to `localhost:15432`, SSL mode `Require`; no public RDS and no SSH key file. |
| Web/API | Existing SST TanStack Start deployment on Lambda and CloudFront | Keep horizontally scalable serverless web path; add alarms for Lambda errors, duration, throttles, and API failures. |
| App worker | Target: ECS Fargate worker service, 2 always-on tasks, autoscale to 12 tasks | Use SQS depth/age as scaling signals. Keep x86 until the Docker image is confirmed multi-arch. |
| Worker EC2 bridge | If ECS migration is not ready: 2 x `m7i.large` EC2 workers behind an Auto Scaling Group | Avoid single-worker production as the final shape. Current repo default is one `t3.medium` worker. |
| Merge jobs | AWS Batch on Fargate, 4 vCPU / 16 GB per job, 80 GiB ephemeral storage | Current infra already uses this shape. Production can raise `maxVcpus` to 32 if merge queues back up. |
| Langfuse | Prefer managed Langfuse or self-hosted `t3.medium` with 100 GB gp3 | If self-hosted, restrict access, back up data, and monitor disk usage. |
| Object storage | S3 bucket with encryption, versioning, lifecycle, and least-privilege IAM | Store uploads, processed artifacts, exports, and long-lived audit assets with clear prefixes. |
| Queueing | SQS standard queues plus DLQs | Add alarms for oldest message age, DLQ messages, and queue depth. |
| Edge/security | CloudFront, Route 53, ACM, AWS WAF | Use WAF managed rules, rate limits, and logging for production public endpoints. |
| Observability | CloudWatch logs, metrics, alarms, dashboards | Alarm on RDS CPU/storage/connections, worker failures, Batch failures, queue age, Lambda errors, and 5xx rates. |
| Secrets | AWS Secrets Manager or SSM Parameter Store | No production secrets in committed files, local shells, or plain-text documentation. |

## Production EC2 Instance Types

These are the EC2-backed components expected in production. The web/API path is serverless through SST and is not an EC2 application in the current architecture.

| Component | Current Repo Default | Proposed Production Type | Monthly Compute Estimate |
| --- | --- | --- | --- |
| Worker | 1 x `t3.medium` | Target ECS Fargate; bridge option 2 x `m7i.large` | `t3.medium`: about USD 38.54 each; `m7i.large`: about USD 91.98 each |
| NAT | 1 x `t3.micro` NAT EC2 | Prefer managed NAT Gateway; cost-sensitive fallback `t3.small` NAT EC2 | `t3.micro`: about USD 9.64; `t3.small`: about USD 19.27 |
| Langfuse | 1 x `t3.micro` | Managed Langfuse, disabled, or 1 x `t3.medium` self-hosted | `t3.micro`: about USD 9.64; `t3.medium`: about USD 38.54 |

If production remains EC2-worker based for the first release, use **2 x `m7i.large` workers** instead of one `t3.medium`. This gives a simple high-availability bridge while the worker is moved to ECS Fargate or another horizontally scalable service.

## Recommended Monthly Cost Estimate

The table below uses current public on-demand pricing references for `ap-southeast-1` and a 730-hour month. Usage-sensitive services are estimated as ranges.

| Resource | Production Assumption | Estimated Monthly Cost |
| --- | --- | ---: |
| Web/API Lambda, CloudFront, Route 53, ACM | Existing SST serverless web/API path | USD 20 to 80 |
| AWS WAF | Web ACL, managed rules, rate controls, low request volume | USD 20 to 60 |
| Worker baseline | ECS Fargate, 2 x 1 vCPU / 2 GB tasks always on | About USD 90 |
| Worker burst headroom | Additional Fargate worker tasks during queues and month-end | USD 25 to 80 |
| RDS PostgreSQL compute | `db.m7g.large`, Multi-AZ | About USD 342 |
| RDS gp3 storage | 100 GB, Multi-AZ gp3 | About USD 28 |
| RDS backups and PITR overhead | Backup storage beyond free allocation, snapshots, logs | USD 5 to 25 |
| Merge Batch jobs | Fargate 4 vCPU / 16 GB jobs, request-driven | USD 15 to 60 |
| Langfuse | Managed/self-hosted baseline with storage and logs | USD 50 to 75 |
| Private networking | NAT Gateway/private egress, SSM endpoints, VPC endpoints | USD 80 to 180 |
| S3 artifacts | Uploads, exports, versioning, lifecycle-managed storage | USD 10 to 40 |
| SQS, ECR, Route 53 hosted zone, small supporting services | Queues, images, DNS, low-volume control plane costs | USD 5 to 25 |
| CloudWatch | Logs, metrics, alarms, dashboards | USD 30 to 90 |
| **Estimated total** | Recommended production target | **USD 715 to 1,175** |
| **Planning buffer** | Recommended budget for approvals | **USD 1,400/month** |

## Cost-Sensitive Production Alternative

If the first production release must optimize for cost over high availability, the environment can start smaller:

| Resource | Cost-Sensitive Shape | Estimated Monthly Cost |
| --- | --- | ---: |
| Worker | 1 x `m7i.large` or `t3.large` EC2 worker | USD 77 to 92 |
| RDS | `db.t4g.medium`, Single-AZ, 100 GB gp3 | About USD 88 |
| NAT | NAT EC2 instead of managed NAT Gateway | USD 10 to 20 plus EBS/data |
| Langfuse | Disabled, managed free/low tier, or `t3.micro` | USD 0 to 25 |
| Serverless web/API, Batch, S3, SQS, CloudWatch, DNS | Low to moderate production usage | USD 130 to 250 |
| **Estimated total** | Lower-cost first release | **USD 305 to 475** |
| **Planning buffer** | Cost-sensitive approval number | **USD 600/month** |

This lower-cost shape is acceptable only if the team accepts reduced availability and more manual operations. The main tradeoffs are Single-AZ database risk, a smaller worker pool, and NAT EC2 maintenance responsibility.

## Gaps From Current Infrastructure

The current repository already supports many production building blocks, but a few changes are needed before using the recommended production target.

| Gap | Current State | Production Recommendation |
| --- | --- | --- |
| Worker scaling | One EC2 worker, `t3.medium`, concurrency 3 | Move workers to ECS Fargate autoscaling, or use at least 2 x `m7i.large` EC2 workers in an Auto Scaling Group. |
| RDS sizing | `db.t4g.micro`, 20 GB, private | Use `db.m7g.large`, Multi-AZ, 100 GB gp3, storage autoscaling, backups, and Performance Insights. |
| NAT | NAT EC2 `t3.micro` | Prefer managed NAT Gateway for production, or document NAT EC2 recovery if cost-sensitive. |
| Langfuse | EC2 `t3.micro`, 100 GB root | Decide managed, disabled, or self-hosted `t3.medium` before production go-live. |
| Batch capacity | `maxVcpus=16` | Raise to 32 if month-end merge queues exceed SLA. |
| WAF | Not a required baseline in current infra notes | Add WAF managed rules and rate limiting before public production traffic. |
| Runbooks | UAT tunnel documented | Add production incident, backup restore, queue drain, and rollback runbooks. |

## Production Security And Access

- Keep RDS private in every environment.
- Do not add public RDS access or allowlisted office CIDRs for pgAdmin.
- Use `pnpm db:tunnel` with `TAXTRACK_DB_TUNNEL_INSTANCE_ID` and `TAXTRACK_DB_TUNNEL_HOST` for controlled operator access.
- Use IAM Identity Center or tightly scoped IAM roles for operators.
- Require MFA for production access.
- Store production secrets in AWS-managed secret storage.
- Restrict self-hosted Langfuse and operational dashboards to approved identities or private access paths.
- Enable CloudTrail and retain production logs according to company policy.

## Production Readiness Checklist

- Confirm production domain, ACM certificate, Route 53 hosted zone, and DNS cutover plan.
- Create production `.env` and secret values outside git.
- Confirm Azure AI/OpenAI/Document Intelligence quotas and cost controls.
- Set up RDS backup retention, PITR, and a restore drill.
- Add SQS DLQs and alarms for queue depth, oldest message age, and failed jobs.
- Add alarms for worker failures, Batch failures, Lambda/API 5xx errors, RDS CPU/storage/connections, and CloudWatch log ingestion spikes.
- Run load tests with month-end style bursts before go-live.
- Validate pgAdmin access through SSM tunnel only.
- Create rollback steps for frontend, backend, worker, and database migrations.
- Document who can approve production access and emergency changes.

## Pricing Sources

- AWS Price List API: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json
- Amazon EC2 pricing: https://aws.amazon.com/ec2/pricing/on-demand/
- Amazon RDS pricing: https://aws.amazon.com/rds/pricing/
- AWS Fargate pricing: https://aws.amazon.com/fargate/pricing/
- Amazon EBS pricing: https://aws.amazon.com/ebs/pricing/
- AWS WAF pricing: https://aws.amazon.com/waf/pricing/
- AWS NAT Gateway pricing: https://aws.amazon.com/vpc/pricing/
- Amazon CloudWatch pricing: https://aws.amazon.com/cloudwatch/pricing/
