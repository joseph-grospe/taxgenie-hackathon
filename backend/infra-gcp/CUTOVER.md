# Production cutover and rollback

## Before the maintenance window

1. Export every current Route 53 record, including MX, TXT, CAA, verification,
   and subdomain records. Recreate and verify them in the Pulumi-managed Cloud
   DNS zone before changing registrar delegation.
2. Delegate the domain to the Cloud DNS name servers while the apex record still
   resolves to AWS. Verify mail and verification records independently.
3. Keep `enableDnsCutover=false`. Deploy the GCP services, certificate DNS
   authorization, global IP, and load balancer. Wait for the managed certificate
   to become active.
4. Lower the AWS apex TTL in advance. Announce that the GCP environment starts
   with an empty database and bucket.

## Maintenance window

1. Run `pnpm deploy:migrate`, then sign in with the seeded super-admin.
2. Upload a synthetic PDF. Verify GCS generation, Cloud Task dispatch ID,
   successful extraction, source preview/download, and result viewing.
3. Confirm telemetry records requested `gemini-3.5-flash`, Google's returned
   model, `high` primary thinking, token usage, GCS generation, and dispatch ID.
4. Run `pnpm deploy:smoke`. Confirm the bucket is not public, unauthenticated
   worker calls fail, and the direct web `run.app` URL cannot bypass the load
   balancer.
5. Set `pulumi config set enableDnsCutover true --stack prod` in
   `backend/infra-gcp`, review `pulumi preview`, then apply. Verify the apex A
   record points to the reserved load-balancer IP.

## Rollback

Restore the apex record to the existing AWS endpoint. Do not delete or alter
GCP data: records and objects created after cutover exist only in GCP and are not
available in AWS. Likewise, historical AWS data is not available in GCP.

For manual archive inspection, use provider-native read-only access:

- PostgreSQL: connect to the retained RDS endpoint through the existing SSM
  tunnel procedure documented in `backend/infra/README.md`.
- Objects and versions: use the AWS console or `aws s3api list-object-versions`
  against the retained bucket with an approved read-only profile.

No GCP script calls AWS, and no cutover step performs an AWS destroy operation.
