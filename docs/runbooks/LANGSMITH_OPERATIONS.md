# LangSmith Cloud Operations

TaxTrack sends selectively redacted LangGraph traces to the LangSmith APAC service. Workflow execution remains on the TaxTrack EC2 workers.

## Workspace and Projects

Use one APAC LangSmith workspace with base retention and these projects:

- `taxtrack-dev`
- `taxtrack-uat`
- `taxtrack-prod`

Create a separate workspace-scoped service key for each deployment environment. Store it as `TAXTRACK_LANGSMITH_API_KEY` in the corresponding GitHub Environment or deployment env file.

## Runtime Configuration

```env
TAXTRACK_LANGSMITH_ENABLED=true
LANGSMITH_API_KEY=<workspace-scoped-service-key>
LANGSMITH_ENDPOINT=https://apac.api.smith.langchain.com
LANGSMITH_PROJECT=taxtrack-uat
LANGCHAIN_CALLBACKS_BACKGROUND=true
```

Do not set `LANGSMITH_TRACING`. TaxTrack constructs one explicit tracer with pre-upload redaction; enabling the SDK's automatic tracer can create duplicate traces.

## Validate Tracing

1. Process a sanitized test certificate.
2. Open the stage project in `https://apac.smith.langchain.com`.
3. Confirm one `worker-workflow:<jobId>` root trace and the expected LangGraph node children.
4. Confirm metadata contains job/event/source/revision identifiers.
5. Search inputs and outputs for known test PDF content, TINs, addresses, prompts, and extracted certificate values. They must appear only as `[REDACTED]`.

Tracing is best effort. A LangSmith outage must not change the SQS disposition or persisted workflow result.

## Disable or Rotate

- Set `TAXTRACK_LANGSMITH_ENABLED=false` for detached/local workers.
- For deployed workers, remove tracing only through an approved deployment change; infrastructure normally injects `true`.
- Rotate one environment at a time: create a new service key, replace `TAXTRACK_LANGSMITH_API_KEY`, deploy, validate a trace, then revoke the old key.
- Never print or commit service keys. Runtime logs report only whether a key is present.

## Shutdown and Retention

The worker drains SQS work and flushes pending LangSmith callbacks on SIGINT/SIGTERM. Projects use base retention; retention policy is managed in the LangSmith UI rather than application code.
