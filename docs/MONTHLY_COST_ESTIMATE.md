# TaxTrack Monthly Cost Estimate

This document estimates monthly infrastructure cost for the current TaxTrack deployment model defined in:

- `backend/infra/index.ts`
- `backend/infra/data.ts`
- `backend/infra/network.ts`
- `backend/infra/compute-electricsql.ts`
- `backend/infra/compute-worker.ts`
- `backend/infra/compute-langfuse.ts`
- `backend/infra/queue.ts`
- `backend/infra/webhook.ts`

All calculations below assume:

- AWS region: `ap-southeast-1` (Singapore)
- Pricing retrieved on `2026-03-08`
- On-demand list pricing
- `730` hours per month
- USD pricing
- No free tier, RI, Savings Plan, enterprise discount, or tax/VAT adjustments

## What the repo actually provisions

### `app` scope

From the current infra code, the lean app deployment includes:

- 1 VPC with public/private subnets, no NAT instance
- 1 Amazon RDS PostgreSQL instance: `db.t4g.micro`
- 20 GB RDS GP3 storage
- 2 S3 buckets: source files and artifacts
- 1 Secrets Manager secret for the webhook secret
- 1 ElectricSQL EC2 instance: `t3.small`
- 1 public Application Load Balancer for ElectricSQL
- 1 CloudFront distribution in front of ElectricSQL
- 1 TanStack Start web deployment

### `all` scope

The full async platform adds:

- 1 NAT EC2 instance: `t3.micro`
- 1 worker EC2 instance: `t3.medium`
- 1 Langfuse EC2 instance: `t3.xlarge`
- 100 GB GP3 root disk on Langfuse
- SQS queue + DLQ
- API Gateway HTTP API
- webhook Lambda functions

## Fixed monthly baseline per live environment

These are the always-on costs that exist even before meaningful traffic arrives.

### `app` scope baseline

| Line item | Current config | Price basis | Monthly estimate |
| --- | --- | --- | ---: |
| RDS PostgreSQL instance | `db.t4g.micro` | `$0.025/hour` | `$18.25` |
| RDS storage | `20 GB` GP3 | `$0.138/GB-month` | `$2.76` |
| ElectricSQL EC2 | `t3.small` | `$0.0264/hour` | `$19.27` |
| ElectricSQL ALB | 1 ALB | `$0.0252/hour` | `$18.40` |
| Secrets Manager | 1 secret | `$0.40/secret-month` | `$0.40` |
| Fixed floor subtotal |  |  | `$59.08` |

Practical note:

- The EC2 root disk size for ElectricSQL is not explicitly set in code. If AWS uses an `8 GB` GP3 root volume, add about `$0.77/month`.
- That moves the practical `app` baseline to about `$59.85/month` before traffic-driven charges.

### `all` scope baseline

| Line item | Current config | Price basis | Monthly estimate |
| --- | --- | --- | ---: |
| `app` scope fixed floor | from above |  | `$59.08` |
| NAT instance | `t3.micro` | `$0.0132/hour` | `$9.64` |
| Worker EC2 | `t3.medium` | `$0.0528/hour` | `$38.54` |
| Langfuse EC2 | `t3.xlarge` | `$0.2112/hour` | `$154.18` |
| Fixed floor subtotal |  |  | `$261.44` |

Practical note:

- If you assume default `8 GB` GP3 roots for NAT, worker, and ElectricSQL, add about `$2.30/month`.
- Langfuse explicitly provisions `100 GB` GP3, which adds about `$9.60/month`.
- That moves the practical `all` baseline to about `$273.34/month` before traffic-driven charges.

## Variable charges to add on top

These are real costs, but they depend on usage more than on the stack shape.

| Service | Current price basis | How to think about it |
| --- | --- | --- |
| ALB LCUs | `$0.008 per LCU-hour` | `1` sustained LCU across the month adds about `$5.84` |
| S3 Standard storage | `$0.025/GB-month` | `100 GB` total across buckets adds about `$2.50` |
| S3 PUT/COPY/POST/LIST | `$0.005 per 1,000 requests` | Usually low unless backfills are large |
| S3 GET and similar | `$0.004 per 10,000 requests` | Usually small for internal dashboards |
| API Gateway HTTP API | `$1.25 per 1M requests` | Webhook traffic should be low relative to EC2/RDS |
| Secrets Manager API calls | `$0.05 per 10,000 requests` | Usually negligible in this design |

Not itemized in the fixed totals:

- CloudFront request and egress charges for the web app and ElectricSQL
- Lambda execution and request charges for the web app/webhook paths
- SQS request charges
- extra RDS snapshot storage beyond the included backup allowance
- Google Workspace / Drive costs
- Azure OpenAI and Mistral usage charges

## Example planning numbers

These are the most useful budget figures for rough planning:

| Scenario | Monthly estimate |
| --- | ---: |
| One live `app` environment, fixed floor only | `$59.08` |
| One live `app` environment, plus likely EC2 root disk | `$59.85` |
| One live `all` environment, fixed floor only | `$261.44` |
| One live `all` environment, plus likely EC2/EBS adders | `$273.34` |
| `dev-app` + `prod-app`, both always on | `$118.16` floor before traffic |
| `dev-all` + `prod-all`, both always on | `$522.87` floor before traffic |

## Main cost driver

The current biggest fixed-cost decision is Langfuse:

- Langfuse compute alone is about `$154.18/month`
- Langfuse disk adds about `$9.60/month`

That means Langfuse is the main reason the `all` scope is roughly `4.4x` the `app`-only baseline.

## What is excluded from the estimate

This estimate is intentionally infra-first. It does not attempt to guess AI usage because the repo does not define:

- monthly document count
- average pages per document
- average prompt/completion token volume
- which Azure OpenAI deployment SKU is actually used in each environment

If you want, add a second section later for per-document AI cost once there is a target workload.

## Source links

AWS pricing sources used for the rates above:

- EC2 Singapore price list: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-southeast-1/index.json`
- RDS Singapore price list: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-southeast-1/index.json`
- S3 Singapore price list: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-southeast-1/index.json`
- ELB Singapore price list: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-southeast-1/index.json`
- API Gateway price list: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/index.json`
- Secrets Manager price list: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/index.json`

Code references used to determine what is deployed:

- `backend/infra/index.ts`
- `backend/infra/data.ts`
- `backend/infra/network.ts`
- `backend/infra/compute-electricsql.ts`
- `backend/infra/compute-worker.ts`
- `backend/infra/compute-langfuse.ts`
- `backend/infra/queue.ts`
- `backend/infra/webhook.ts`
