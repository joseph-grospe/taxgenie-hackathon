# Monthly Cost Estimate Notes

This document tracks the main infrastructure cost drivers for the current manual upload architecture.

## Primary Cost Drivers

- TanStack Start app hosting
- RDS PostgreSQL
- S3 source and artifact storage
- SQS queue and DLQ
- Async worker compute
- LangSmith Cloud trace usage and retention

## Operational Levers

- Keep worker concurrency conservative until queue volume justifies scaling.
- Apply S3 lifecycle policies to raw and intermediate artifacts.
- Use `web` scope when you only need the UI surface.
- Use `app` scope when you need full upload processing.
- Keep LangSmith tracing disabled locally unless a trace is needed, and use base retention for deployed projects.

## What Changed

- The platform no longer depends on a separate external listener tier for intake.
- Queue production now happens inside the authenticated app runtime after upload completion.
- Cost review should focus on app, storage, queue, and worker utilization rather than a separate ingress service.
