# UAT Monthly Billing Analysis

Prepared on 2026-05-20.

## Executive Summary

Expected UAT billing is roughly **USD 435 to USD 520 per month before tax** when processing the planned **8,000 BIR 2307 certificates per month**.

With a tax buffer similar to the current AWS bill, plan for about **USD 490 to USD 585 per month**.

If UAT is kept online but little or no document processing happens, the AWS-only idle/scheduled environment is closer to **USD 260 to USD 315 per month before tax**.

## Current UAT Shape

The deployed UAT environment is a full SST stage in AWS Singapore (`ap-southeast-1`) with `TAXTRACK_POWER_SCHEDULE_ENABLED=true`.

Current live checks showed:

| Area | Current UAT resource | State / note |
| --- | --- | --- |
| Worker | EC2 `m7i.large` | Stopped outside schedule |
| NAT | EC2 `t3.micro` | Stopped outside schedule |
| ElectricSQL | EC2 `t3.small` | Stopped outside schedule |
| Langfuse | EC2 `t3.small`, 100 GB gp3 root volume | Stopped outside schedule |
| Database | RDS PostgreSQL `db.t4g.medium`, Single-AZ | Stopped outside schedule; AWS currently reports 20 GB allocated storage |
| Network | 3 interface VPC endpoints across 2 subnets | Always billed |
| ElectricSQL ingress | 1 public ALB | Always billed |
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
| Scheduled EC2 runtime: worker, NAT, ElectricSQL, Langfuse | USD 80 to 100 |
| Scheduled RDS runtime | USD 44 |
| VPC interface endpoints for SSM, SSM messages, EC2 messages | USD 57 |
| ElectricSQL ALB and low LCU usage | USD 24 to 30 |
| EC2 gp3 root volumes, including Langfuse 100 GB | USD 12 |
| RDS storage, current 20 GB | USD 3 |
| Public IPv4 addresses | USD 10 to 18 |
| S3, SQS, ECR, Lambda, CloudFront, Route 53, SES, CloudWatch | USD 30 to 55 |
| **AWS scheduled/idle subtotal** | **USD 260 to 315** |

Variable AI cost for 8,000 certificates:

| AI cost driver | Basis | Estimate / month |
| --- | --- | ---: |
| Mistral OCR 3 | USD 2 / 1,000 pages; assumes 1 page per certificate | USD 16 |
| Azure OpenAI GPT-4.1 normalization | Based on cached project samples averaging about 7,003 input tokens and 706 output tokens per certificate | USD 157 to 175 |
| Zone OCR fallback / retries buffer | Extra OCR calls when fallback or retry paths trigger | USD 0 to 15 |
| **AI subtotal for 8,000 certificates** |  | **USD 175 to 205** |

Combined:

| Scenario | Before tax | With ~12% tax buffer |
| --- | ---: | ---: |
| UAT online, little/no processing | USD 260 to 315 | USD 290 to 355 |
| Planned 8,000 certificates/month | USD 435 to 520 | USD 490 to 585 |
| Heavy retest, about 16,000 certificates/month | USD 610 to 725 | USD 685 to 815 |

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

- **Power schedule is working** and saves roughly **USD 85 to 100/month** versus running EC2 and RDS 24/7.
- **VPC interface endpoints and ALB are fixed baseline costs** even when app compute is stopped. Together they are roughly **USD 80/month**.
- **Azure OpenAI normalization costs more than OCR** at 8,000 certificates/month. OCR is about USD 16/month; normalization is about USD 160 to 175/month.
- **Repeated UAT reruns matter.** Every additional 8,000 full reprocessed certificates adds about **USD 175 to 205** in AI usage.
- **Cost allocation tags should be activated** for `sst:stage` and `sst:app`, or explicit `Environment=uat` tags should be added and activated. Without that, AWS billing cannot cleanly separate UAT from dev/staging resources.

## Sources

- AWS rates were checked through AWS Price List / Cost Explorer for `ap-southeast-1` and cross-checked against official AWS pricing pages: [EC2 On-Demand](https://aws.amazon.com/ec2/pricing/on-demand/), [RDS PostgreSQL](https://aws.amazon.com/rds/postgresql/pricing/), [VPC](https://aws.amazon.com/vpc/pricing/), [Elastic Load Balancing](https://aws.amazon.com/elasticloadbalancing/pricing/), [Fargate](https://aws.amazon.com/fargate/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), and [Lambda](https://aws.amazon.com/lambda/pricing/).
- Mistral OCR 3 pricing: [`mistral-ocr-2512`](https://docs.mistral.ai/models/ocr-3-25-12) at USD 2 / 1,000 pages and USD 3 / 1,000 annotated pages.
- GPT-4.1 token pricing basis: [OpenAI GPT-4.1](https://platform.openai.com/docs/models/gpt-4.1) at USD 2 / 1M input tokens and USD 8 / 1M output tokens. [Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/) can vary by deployment type, region, and offer, so the estimate keeps a small Azure buffer.
