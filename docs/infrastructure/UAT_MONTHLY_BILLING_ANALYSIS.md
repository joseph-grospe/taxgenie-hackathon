# UAT Monthly Billing Analysis

Prepared on 2026-05-20 and updated on 2026-07-27 for the Gemini 3 Flash Preview UAT extraction target.

## Executive Summary

Expected UAT billing is roughly **USD 290 to USD 465 per month before tax** when processing the planned **8,000 BIR 2307 certificates per month**.

With a tax buffer similar to the current AWS bill, plan for about **USD 325 to USD 520 per month** until measured UAT token data replaces the scenario assumptions below.

If UAT is kept online but little or no document processing happens, the AWS-only idle/scheduled environment is closer to **USD 225 to USD 275 per month before tax**.

## Current UAT Shape

The target UAT environment is a full SST stage in AWS Singapore (`ap-southeast-1`) with `TAXTRACK_POWER_SCHEDULE_ENABLED=true`.

After the next full SST deployment, the repository target is:

| Area | Target UAT resource | State / note |
| --- | --- | --- |
| Worker | EC2 `m7i.large` | Stopped outside schedule |
| NAT | EC2 `t3.micro` | Stopped outside schedule |
| Langfuse | EC2 `t3.small`, 100 GB gp3 root volume | Stopped outside schedule |
| Database | RDS PostgreSQL `db.t4g.medium`, Single-AZ | Stopped outside schedule; AWS currently reports 20 GB allocated storage |
| Network | 3 interface VPC endpoints across 2 subnets | Always billed |
| Storage | S3 UAT app/storage buckets | Current storage is small: under 100 MiB combined |
| Queues | SQS queue and DLQ | Request-based; low baseline |
| Merge worker | AWS Batch Fargate | Billed only when merge jobs run |

The repo UAT sizing profile says RDS storage should be 100 GB, but AWS currently reports 20 GB. If/when storage is raised to 100 GB, add about **USD 11/month** at current Singapore RDS gp3 pricing.

## Cost Estimate

This estimate uses average monthly schedule hours:

- Compute: about 426 hours/month, from 8:00 AM to 10:00 PM daily.
- RDS: about 433 hours/month, from 7:45 AM to 10:00 PM daily.
- Always-on resources: 730 hours/month.

| Cost driver | Estimate / month |
| --- | ---: |
| Scheduled EC2 runtime: worker, NAT, Langfuse | USD 70 to 90 |
| Scheduled RDS runtime | USD 44 |
| VPC interface endpoints for SSM, SSM messages, EC2 messages | USD 57 |
| EC2 gp3 root volumes, including Langfuse 100 GB | USD 12 |
| RDS storage, current 20 GB | USD 3 |
| Public IPv4 addresses | USD 8 to 14 |
| S3, SQS, ECR, Lambda, CloudFront, Route 53, SES, CloudWatch | USD 30 to 55 |
| **AWS scheduled/idle subtotal** | **USD 225 to 275** |

Variable AI cost for 8,000 one-page certificates:

| AI cost driver | Basis | Estimate / month |
| --- | --- | ---: |
| Gemini 3 Flash Preview standard input | USD 0.50 / 1M text, image, video, or PDF tokens | Included below |
| Gemini 3 Flash Preview standard output | USD 3.00 / 1M output tokens, including thinking tokens | Included below |
| Low scenario | 4,000 input + 2,000 output/thinking tokens per page | USD 64 |
| Planning scenario | 6,000 input + 3,000 output/thinking tokens per page | USD 96 |
| High scenario | 8,000 input + 6,000 output/thinking tokens per page | USD 176 |
| Retry and preview-rate buffer | Controlled Gemini retries may add billable requests | USD 0 to 15 |
| **AI subtotal for 8,000 certificates** | Replace scenarios with captured UAT usage | **USD 64 to 190** |

Per-page cost is calculated as:

```txt
(prompt_tokens × 0.50 + (output_tokens + thought_tokens) × 3.00) / 1,000,000
```

The worker records prompt, output, thought, and total tokens for every successful Gemini document request. The labeled UAT evaluation must use those recorded values rather than the planning scenarios. Each uploaded PDF now produces one Gemini request, including multi-page PDFs. Multi-page inputs can still consume more input tokens, but they no longer multiply request count by page count.

Combined:

| Scenario | Before tax | With ~12% tax buffer |
| --- | ---: | ---: |
| UAT online, little/no processing | USD 225 to 275 | USD 250 to 310 |
| Planned 8,000 certificates/month | USD 290 to 465 | USD 325 to 520 |
| Heavy retest, about 16,000 certificates/month | USD 355 to 655 | USD 400 to 735 |

## Account-Level Sanity Check

AWS Cost Explorer for 2026-05-01 through 2026-05-20 returned **USD 232.37 including tax** for the account, or **USD 207.50 before tax**. Straight-line projection for a 31-day month is about **USD 379 including tax**.

This is not clean UAT-only cost because cost allocation tags are not active for `sst:stage=uat`, and the account also contains non-UAT resources. The largest month-to-date service costs were:

| Service | Month-to-date cost |
| --- | ---: |
| EC2 compute | USD 109.32 |
| VPC | USD 29.83 |
| Tax | USD 24.87 |
| EC2 other | USD 22.63 |
| RDS | USD 22.59 |
| ELB | USD 18.60 |

The account-level projection is useful as a billing sanity check, but the UAT forecast above is the better planning number for this stage.

## Main Cost Levers

- **Power schedule is working** and saves roughly **USD 75 to 90/month** versus running EC2 and RDS 24/7.
- **VPC interface endpoints are fixed baseline costs** even when app compute is stopped. They are roughly **USD 57/month**.
- **Gemini is the sole extraction provider.** The local visual detector, PDF text-layer recovery, normalization, and validation add compute time but no separate model-token charge.
- **High thinking is included in output pricing.** Thought tokens can be the largest variable, so every evaluated page must retain usage counts.
- **Repeated UAT reruns matter.** Every additional 8,000 one-page certificates adds about **USD 64 to 190** under the current scenarios.
- **Cost allocation tags should be activated** for `sst:stage` and `sst:app`, or explicit `Environment=uat` tags should be added and activated. Without that, AWS billing cannot cleanly separate UAT from dev/staging resources.

## Sources

- AWS rates were checked through AWS Price List / Cost Explorer for `ap-southeast-1` and cross-checked against official AWS pricing pages: [EC2 On-Demand](https://aws.amazon.com/ec2/pricing/on-demand/), [RDS PostgreSQL](https://aws.amazon.com/rds/postgresql/pricing/), [VPC](https://aws.amazon.com/vpc/pricing/), [Elastic Load Balancing](https://aws.amazon.com/elasticloadbalancing/pricing/), [Fargate](https://aws.amazon.com/fargate/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), and [Lambda](https://aws.amazon.com/lambda/pricing/).
- Gemini Developer API pricing: [`gemini-3-flash-preview`](https://ai.google.dev/gemini-api/docs/pricing) at USD 0.50 / 1M standard input tokens and USD 3.00 / 1M standard output tokens including thinking tokens, checked 2026-07-27.
- Gemini model capabilities and exact preview ID: [Gemini 3 Flash Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview).
