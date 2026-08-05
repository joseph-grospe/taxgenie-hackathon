# Tech Stack - TaxTrack

This document reflects the current manual upload architecture.

## App Runtime

| Concern | Technology | Notes |
| --- | --- | --- |
| Web UI | TanStack Start, React, TypeScript | Authenticated operational UI and server routes |
| Auth | Better Auth | Email/password login and session management |
| Route Authorization | Central access-control policy | `admin`, `editor`, `viewer` route gating |
| Database | Amazon RDS PostgreSQL + Drizzle ORM | Auth, intake state, worker state, and results |
| Object Storage | AWS S3 | Direct browser uploads and generated artifacts in one entity-scoped storage bucket |
| Queueing | AWS SQS | One message per completed upload |
| Async Processing | TypeScript worker on AWS | Long-poll consumer that runs the document workflow |
| AI Extraction | Gemini Developer API (`gemini-3-flash-preview`) | One strict agentic extraction request per original PDF |
| Artifact Storage | AWS S3 | Source PDFs and one reconstructed PDF per extracted certificate |
| Observability | Langfuse + CloudWatch | Workflow traces and runtime logs |

## Upload Intake Path

1. `POST /api/uploads/presign`
2. Browser `PUT` upload to S3 using a presigned URL
3. `POST /api/uploads/complete`
4. S3 object validation with `HeadObject`
5. SQS enqueue
6. Worker processing

## Deployment Scopes

- `web`: webapp-only surface; upload processing can be hidden or incomplete.
- `app`: webapp, Postgres, S3 access, queue, and worker for full upload processing.
- `all`: full platform deployment including optional observability services.

## Package Ownership

- `webapp/tax-track`: UI, app routes, auth, and DB-backed intake endpoints.
- `backend/shared`: shared queue contracts, config parsing, logging, and tracing helpers.
- `backend/worker`: SQS consumer and LangGraph workflow.
- `backend/infra`: infrastructure definitions and deployment wiring.

## Operational Notes

- PDF uploads are single-part presigned `PUT` uploads in v1.
- The app validates uploaded object size and content type before queueing.
- Worker idempotency keys off event identity rather than external source semantics.
- Batch and file visibility are persisted in Postgres so status survives refreshes and deploys.
