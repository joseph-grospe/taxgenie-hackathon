# Certificate Duplicate Detection

## Purpose

TaxTrack uses two cross-upload signals to prevent an already accepted BIR 2307
certificate from entering the accepted workflow again:

1. exact uploaded PDF content
2. normalized certificate business data

Duplicate detection is intentionally best-effort. It does not add uniqueness
constraints or serialize simultaneous uploads.

## Processing Order

The worker completes extraction, masterlist resolution, and normal certificate
validation before querying duplicate history.

- Invalid certificates remain errors and do not issue dedupe queries.
- Files containing multiple certificates remain errors and do not issue dedupe
  queries.
- Only a currently valid, single-certificate file can be classified as a
  duplicate.

The two historical lookups run concurrently after validation succeeds.

## Signal 1: Exact Source Content

The worker compares the current SHA-256 `sourceHash` with
`document_results.source_hash`.

A historical row qualifies only when:

- it belongs to a different upload;
- its document status is `accepted`; and
- its source hash equals the current source hash.

A match adds `duplicate_source_document`.

## Signal 2: Normalized Certificate Fingerprint

The worker builds a SHA-256 fingerprint from canonical certificate fields:

- period start and end;
- payee and payor names and TINs;
- primary ATC;
- total tax base and tax withheld; and
- normalized ATC, tax-base, and tax-withheld values for each tax row.

A historical row qualifies only when:

- it belongs to a different upload;
- the certificate status is `accepted`;
- its parent document status is `accepted`; and
- its fingerprint equals the current certificate fingerprint.

A match adds `duplicate_certificate`. The worker links to the earliest matching
accepted certificate by creation time and ID.

## Duplicate Outcome

Either signal is sufficient to produce a duplicate outcome. When both match,
both reason codes are retained exactly once.

The worker persists:

- document status `duplicate`;
- certificate status `duplicate`;
- terminal outcome `Duplicate`;
- the extracted relational projection and tax rows; and
- the original source-PDF artifact reference.

Duplicate results do not reserve a processed certificate number, generate a
certificate PDF, reconcile, sign, or qualify as candidates for later duplicate
checks. Later duplicate uploads continue matching the original accepted result.

## Compatibility

New duplicate decisions use only:

- `duplicate_source_document`
- `duplicate_certificate`

The web application continues formatting older duplicate reason codes for
historical records. Original-filename and source-file-revision matching are not
part of the current worker decision.

No schema migration is required. The existing source-hash, status, and
fingerprint indexes support these lookups.

## Concurrency Limitation

The lookups occur before the current result is persisted. Two identical uploads
processed simultaneously can both observe no accepted match and both become
accepted. Preventing that race would require database-enforced uniqueness and
conflict handling, which is outside this policy.

## Required Regression Coverage

- each signal independently produces a duplicate;
- both signals retain both reason codes;
- invalid and multi-certificate inputs perform no dedupe lookups;
- error and duplicate history cannot qualify;
- the current upload cannot match itself;
- fingerprint linkage selects the earliest accepted certificate; and
- duplicate persistence produces no generated certificate artifact or
  downstream reconciliation work.
