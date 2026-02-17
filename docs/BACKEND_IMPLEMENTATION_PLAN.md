# Backend Implementation Plan (TypeScript + AWS)

This document is the implementation reference for the new backend stack under `backend/`.

## Scope

- Replace the Python ingestion/processing path with TypeScript services.
- Use AWS Lambda + API Gateway for webhook ingress.
- Use SQS Standard + DLQ for asynchronous queueing.
- Use an EC2-hosted worker (Docker) for LangGraph execution.
- Use RDS Postgres for state and S3 for artifacts.
- Run ElectricSQL and Langfuse on dedicated EC2 instances.

## Implemented Repository Structure

```text
backend/
  infra/
  shared/
  lambda/
  worker/
  langfuse/
```

## Infrastructure Model

- Managed in `sst.config.ts` + Pulumi resources in `backend/infra/`.
- Environments: `dev` and `prod`.
- Networking:
1. Public webhook entry via API Gateway.
2. Private worker/data plane subnet.
3. NAT Instance for private outbound traffic.

## Key Components

### Lambda Webhook

- Entry: `POST /webhooks/google-drive`
- Validates:
1. `x-taxtrack-webhook-secret`
2. `x-goog-channel-id`
3. `x-goog-resource-id`
4. `x-goog-resource-state`
- Resolves Drive changes and publishes `DriveFileEventV1` events to SQS.

### SQS

- Queue: `taxtrack-events-{stage}`
- DLQ: `taxtrack-events-dlq-{stage}`
- Redrive policy: `maxReceiveCount=5`

### Worker

- Express endpoints:
1. `GET /healthz`
2. `GET /readyz`
3. `POST /admin/pause`
4. `POST /admin/resume`
5. `POST /admin/drain`
- Poller:
1. Long polling (`20s`)
2. In-process bounded concurrency
3. Visibility timeout heartbeat extension
- LangGraph nodes:
1. `load_input`
2. `extract_document`
3. `normalize_fields`
4. `validate_rules`
5. `persist_results`

### Data Layer

- RDS Postgres tables:
1. `drive_channels`
2. `worker_jobs`
3. `worker_job_steps`
4. `worker_idempotency`
5. `document_results`
- S3 stores result artifacts.

### Langfuse

- Dedicated EC2 deployment with Docker Compose topology.
- Worker and webhook both emit traces/spans.

## Mermaid Diagram

```mermaid
flowchart TD
  subgraph Ingress
    DriveEvent["Google Drive change notification"] --> ApiGw["API Gateway"]
    ApiGw --> Lambda["Lambda Webhook /webhooks/google-drive"]
    Lambda --> Validator{"Validate headers + channel/resource IDs"}
    Validator -->|valid| Resolve["Resolve Drive change"]
    Validator -->|invalid| Reject["Reject request"]
    Resolve --> Sqs["Publish DriveFileEventV1 to SQS"]
  end

  subgraph DataPlane
    Sqs --> DLQ["DLQ maxReceiveCount=5"]
    Sqs --> Worker["EC2 Worker Container"]
    Worker --> Poller["Long-polling SQS 20s; visibility heartbeat"]
    Poller --> Node1["load_input"]
    Node1 --> Node2["extract_document"]
    Node2 --> Node3["normalize_fields"]
    Node3 --> Node4["validate_rules"]
    Node4 --> Node5["persist_results"]
    Node5 --> RDS["RDS Postgres"]
    Node5 --> S3["S3 Artifacts"]
    Node5 --> Trace["Langfuse Traces"]
    Worker --> Health["GET /healthz"]
    Worker --> Ready["GET /readyz"]
    Worker --> Pause["POST /admin/pause"]
    Worker --> Resume["POST /admin/resume"]
    Worker --> Drain["POST /admin/drain"]
  end

  subgraph Storage
    RDS --> Tables["Tables: drive_channels, worker_jobs, worker_job_steps, worker_idempotency, document_results"]
  end

  subgraph Operational
    CI["backend-ci.yml lint/typecheck/tests"] --> CDdev["backend-deploy-dev.yml"]
    CI --> CDprod["backend-deploy-prod.yml manual gate"]
  end
```

## Mermaid Diagram (SST Infra)

```mermaid
flowchart TD
  subgraph SstEntry["SST Entry"]
    SstApp["sst.config.ts"]
    SstApp --> Build["buildInfrastructure()"]
    ProfileCfg["TAXTRACK_INFRA_PROFILE"]
    Build --> ProfileCfg
    ProfileCfg -->|localdev| LocalProfile
    ProfileCfg -->|full| FullProfile
    Build --> LocalProfile
    Build --> FullProfile
  end

  subgraph LocalProfileScope["Localdev Profile"]
    LocalProfile["Localdev stack"]
    LocalWebhook["createWebhookLocalDev"]
    LocalFrontend["createWebTrackFrontend"]
    LocalQueue["local SQS queue"]
    LocalProfile --> LocalWebhook
    LocalProfile --> LocalFrontend
    LocalWebhook --> LocalQueue
  end

  subgraph FullProfileScope["Full Profile"]
    FullProfile["Full stack"]

    subgraph Network["Network Components (createNetwork)"]
      Vpc["VPC 10.42.0.0/16"]
      PublicSubnet["Public subnet 10.42.0.0/24"]
      PrivateSubnet["Private subnet 10.42.1.0/24"]
      NatInstance["NAT EC2"]
      InternetGateway["Internet Gateway"]
      LambdaSG["Lambda SG"]
      WorkerSG["Worker SG"]
      RDSSG["RDS SG"]
      ESqlSG["ElectricSQL SG"]
      LangfuseSG["Langfuse SG"]
      Vpc --> InternetGateway
      Vpc --> PublicSubnet --> InternetGateway
      PublicSubnet --> NatInstance --> PrivateSubnet
      PrivateSubnet --> LambdaSG
      PrivateSubnet --> WorkerSG
      PrivateSubnet --> RDSSG
      PrivateSubnet --> ESqlSG
      PublicSubnet --> LangfuseSG
      FullProfile --> Vpc
    end

    subgraph DataPlane["Data Layer (createData)"]
      Rds["RDS Postgres"]
      Bucket["S3 Artifacts Bucket"]
      Secret["Secrets Manager webhook secret"]
      FullProfile --> Rds
      FullProfile --> Bucket
      FullProfile --> Secret
    end

    subgraph Messaging["Queue Layer (createQueue)"]
      Queue["SQS queue taxtrack-events-{stage}"]
      Dlq["SQS DLQ taxtrack-events-dlq-{stage}"]
      Queue --> Dlq
      FullProfile --> Queue
      FullProfile --> Dlq
    end

    subgraph ApiWebhook["Webhook Compute (createWebhook)"]
      ApiGw["API Gateway HTTP API"]
      WebhookLambda["Webhook Lambda (Node 22.x)"]
      WebhookLambdaRole["Lambda IAM Role"]
      FullProfile --> ApiGw
      ApiGw --> WebhookLambda
      WebhookLambda --> Queue
      FullProfile --> WebhookLambdaRole
    end

    subgraph WorkerCompute["Worker Compute (createWorkerCompute)"]
      WorkerEC2["Worker EC2"]
      WorkerRole["Worker IAM Role + Profile"]
      FullProfile --> WorkerRole
      WorkerSG --> WorkerEC2
      WorkerEC2 --> Queue
      WorkerEC2 --> Dlq
      WorkerEC2 --> Rds
      WorkerEC2 --> Bucket
    end

    subgraph Sidecars["Sidecar Services"]
      ElectricSql["ElectricSQL EC2"]
      Langfuse["Langfuse EC2 + EIP"]
      FullProfile --> ElectricSql
      FullProfile --> Langfuse
      ElectricSql --> Rds
      Langfuse --> Bucket
      WorkerEC2 --> Langfuse
      WebhookLambda --> Langfuse
    end
  end

  subgraph Frontend["Application Layer"]
    Webapp["TanStack Start frontend"]
    FullProfile --> Webapp
    LocalProfile --> Webapp
  end
```

## CI/CD

- `backend-ci.yml`: lint/typecheck/tests.
- `backend-deploy-dev.yml`: deploy dev stage.
- `backend-deploy-prod.yml`: deploy prod stage with manual gate.

## Next Steps

1. Replace fixture-based Drive change resolution with full Google Drive API client integration.
2. Replace extraction/normalization stubs with real Mistral and Azure OpenAI provider calls.
3. Add integration tests for queue and worker lifecycle.
