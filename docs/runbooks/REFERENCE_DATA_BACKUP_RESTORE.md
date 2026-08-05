# Reference Data Backup and Restore

Use this runbook before a UAT deployment that could affect TaxTrack users or
reference data.

The logical backup contains:

- `public.user`
- `public.account`
- `public.user_signature_profiles`
- `public.entities`
- `public.masterlist`
- `public.atc_codes`

The `account` table is included because it contains the password hashes linked
to users. Sessions and verification tokens are intentionally excluded.

## Prerequisites

- Docker is running.
- The target stage env file contains the RDS tunnel settings and
  `TAXTRACK_DB_PASSWORD`.
- The AWS SSM tunnel prerequisites in
  [DEPLOYED_DATABASE_ACCESS.md](DEPLOYED_DATABASE_ACCESS.md) are satisfied.

## Create a UAT backup

In terminal 1, start the private RDS tunnel and leave it open:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm db:tunnel
```

In terminal 2, create the backup:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm db:backup:reference
```

The script writes a timestamped directory under `backups/uat/`. Backup
directories are ignored by Git and use owner-only permissions.

Each successful backup contains:

- a PostgreSQL custom-format archive
- source row counts from before and after the dump
- restored row counts
- the archive catalog
- SHA-256 checksums
- a manifest without credentials

The command succeeds only after restoring the archive into an isolated
PostgreSQL container and confirming that every table's restored row count
matches the source.

## Verify an existing backup

From inside a timestamped backup directory:

```bash
shasum -a 256 -c SHA256SUMS
```

Review `MANIFEST.txt` and the three `row-counts-*.tsv` files. The count files
must match exactly.

## Restore safely

Do not restore directly over a populated database as a first step. The selected
tables have identity, unique, and foreign-key constraints, and existing
workflow data can reference users and entities.

1. Stop application writes.
2. Take another backup of the current target.
3. Restore the archive into an isolated PostgreSQL database.
4. Validate users, entity IDs, masterlist rows, and ATC rates.
5. Decide whether the incident requires a full replacement or a controlled
   merge into the target.

To restore the complete selected schema and data into an empty database:

```bash
pg_restore \
  --no-owner \
  --no-privileges \
  --dbname="$RESTORE_DATABASE_URL" \
  taxtrack-reference-data-<stage>-<timestamp>.dump
```

To load only data after applying the repository migrations to an empty target:

```bash
pg_restore \
  --data-only \
  --no-owner \
  --no-privileges \
  --dbname="$RESTORE_DATABASE_URL" \
  taxtrack-reference-data-<stage>-<timestamp>.dump
```

For a populated target, restore to an isolated database first and merge with
reviewed SQL. Do not use `--clean` against UAT unless the exact dependency and
rollback impact has been reviewed.

## Scope limitation

This is a database backup. `user_signature_profiles` contains S3 object keys,
but the referenced signature images are not copied by this script. Use the
RDS/S3 platform backups when a complete environment rollback is required.
