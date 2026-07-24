# TaxTrack App Infra Changes

## Current Direction

The app scope now supports the manual upload pipeline end to end instead of only the app-facing surface.

## Included In `app`

- TanStack Start webapp
- Amazon RDS PostgreSQL
- S3 access for presign and object validation
- SQS queue access for upload completion
- Async worker required to process uploaded files

## Included In `all`

- everything in `app`
- optional observability and broader platform services

## Notes

- `web` can still be used for a UI-only surface when processing is intentionally disabled.
- Bucket CORS must allow browser `PUT` and `HEAD` calls for direct uploads.
- Queue and worker resources are part of the upload capability, not a separate optional intake system.
