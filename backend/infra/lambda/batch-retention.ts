import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import {
  VersionedS3CleanupError,
  deleteVersionedS3Objects,
  emptyVersionedS3CleanupStats,
  type VersionedS3CleanupStats,
} from "./versioned-s3-retention";

type BatchRetentionEvent = {
  now?: string;
  limit?: number;
  targetType?: "batch" | "upload";
  targetId?: string;
};

export type BatchRetentionFailurePhase =
  | "list_versions"
  | "delete_versions"
  | "verify_empty"
  | "purge_database";

type BatchRetentionSummary = VersionedS3CleanupStats & {
  batchId: string;
  objectKeyCount: number;
  retryAgeSeconds: number;
};

type FailedBatchRetentionSummary = BatchRetentionSummary & {
  failurePhase: BatchRetentionFailurePhase;
  failedVersionDeleteCount: number;
  remainingVersionTargetCount: number;
};

export type BatchRetentionResponse = {
  purged: BatchRetentionSummary[];
  failed: FailedBatchRetentionSummary[];
  uploadPurged?: UploadRetentionSummary[];
  uploadFailed?: FailedUploadRetentionSummary[];
};

export type BatchPurgeState = {
  batchId: string;
  documentResultIds: number[];
  certificateIds: number[];
  mergeJobIds: string[];
  workerJobIds: string[];
  objectKeys: string[];
};

export type UploadPurgeState = {
  uploadId: string;
  batchId: string;
  fileName: string;
  requestedByUserId: string | null;
  documentResultIds: number[];
  certificateIds: number[];
  workerJobIds: string[];
  objectKeys: string[];
};

type UploadRetentionSummary = VersionedS3CleanupStats & {
  uploadId: string;
  batchId: string;
  objectKeyCount: number;
};

type FailedUploadRetentionSummary = UploadRetentionSummary & {
  failurePhase: BatchRetentionFailurePhase;
  failedVersionDeleteCount: number;
  remainingVersionTargetCount: number;
};

const defaultRegion = "ap-southeast-1";
const defaultLimit = 25;

function shouldUseSsl(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname;

  return !["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function toNodePgConnectionString(databaseUrl: string): string {
  const connectionUrl = new URL(databaseUrl);

  connectionUrl.searchParams.delete("sslmode");
  connectionUrl.searchParams.delete("sslcert");
  connectionUrl.searchParams.delete("sslkey");
  connectionUrl.searchParams.delete("sslrootcert");

  return connectionUrl.toString();
}

function normalizeObjectKey(value: unknown, bucket: string): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("s3://")) {
    const withoutScheme = trimmed.slice("s3://".length);
    const separatorIndex = withoutScheme.indexOf("/");
    if (separatorIndex === -1) {
      return null;
    }

    const objectBucket = withoutScheme.slice(0, separatorIndex);
    const key = withoutScheme.slice(separatorIndex + 1);
    return objectBucket === bucket && key ? key : null;
  }

  return trimmed;
}

export async function collectBatchPurgeState(
  client: PoolClient,
  batchId: string,
  bucket: string,
): Promise<BatchPurgeState> {
  const [filesResult, resultsResult, jobsResult] = await Promise.all([
    client.query<{ storage_key: string; artifact_uri: string | null }>(
      `
        SELECT "storage_key", "artifact_uri"
        FROM "intake_files"
        WHERE "batch_id" = $1
      `,
      [batchId],
    ),
    client.query<{ id: number }>(
      `
        SELECT "id"
        FROM "document_results"
        WHERE "batch_id" = $1
      `,
      [batchId],
    ),
    client.query<{ job_id: string }>(
      `
        SELECT "job_id"
        FROM "worker_jobs"
        WHERE "batch_id" = $1
      `,
      [batchId],
    ),
  ]);
  const objectKeys = new Set<string>();

  for (const file of filesResult.rows) {
    for (const value of [file.storage_key, file.artifact_uri]) {
      const key = normalizeObjectKey(value, bucket);
      if (key) {
        objectKeys.add(key);
      }
    }
  }

  const documentResultIds = resultsResult.rows.map((result) => result.id);
  let certificateIds: number[] = [];
  let mergeJobIds: string[] = [];

  if (documentResultIds.length > 0) {
    const [certificatesResult, resultArtifactsResult] = await Promise.all([
      client.query<{ id: number }>(
        `
          SELECT "id"
          FROM "extracted_certificates"
          WHERE "document_result_id" = ANY($1::int[])
        `,
        [documentResultIds],
      ),
      client.query<{ bucket: string; key: string }>(
        `
          SELECT "bucket", "key"
          FROM "result_artifacts"
          WHERE "document_result_id" = ANY($1::int[])
        `,
        [documentResultIds],
      ),
    ]);
    certificateIds = certificatesResult.rows.map(
      (certificate) => certificate.id,
    );

    for (const artifact of resultArtifactsResult.rows) {
      if (artifact.bucket === bucket && artifact.key.trim()) {
        objectKeys.add(artifact.key.trim());
      }
    }
  }

  if (certificateIds.length > 0) {
    const [signedArtifactsResult, mergeInputsResult] = await Promise.all([
      client.query<{ source_pdf_key: string; signed_pdf_key: string | null }>(
        `
          SELECT "source_pdf_key", "signed_pdf_key"
          FROM "certificate_signed_artifacts"
          WHERE "certificate_id" = ANY($1::int[])
        `,
        [certificateIds],
      ),
      client.query<{ merge_job_id: string }>(
        `
          SELECT "merge_job_id"
          FROM "certificate_merge_job_inputs"
          WHERE "certificate_id" = ANY($1::int[])
        `,
        [certificateIds],
      ),
    ]);

    for (const artifact of signedArtifactsResult.rows) {
      for (const value of [artifact.source_pdf_key, artifact.signed_pdf_key]) {
        const key = normalizeObjectKey(value, bucket);
        if (key) {
          objectKeys.add(key);
        }
      }
    }

    mergeJobIds = Array.from(
      new Set(mergeInputsResult.rows.map((input) => input.merge_job_id)),
    );
  }

  if (mergeJobIds.length > 0) {
    const mergeOutputsResult = await client.query<{ output_key: string }>(
      `
        SELECT "output_key"
        FROM "certificate_merge_job_outputs"
        WHERE "merge_job_id" = ANY($1::uuid[])
      `,
      [mergeJobIds],
    );

    for (const output of mergeOutputsResult.rows) {
      const key = normalizeObjectKey(output.output_key, bucket);
      if (key) {
        objectKeys.add(key);
      }
    }
  }

  return {
    batchId,
    documentResultIds,
    certificateIds,
    mergeJobIds,
    workerJobIds: jobsResult.rows.map((job) => job.job_id),
    objectKeys: Array.from(objectKeys),
  };
}

export async function collectUploadPurgeState(
  client: PoolClient,
  uploadId: string,
  bucket: string,
): Promise<UploadPurgeState> {
  const fileResult = await client.query<{
    id: string;
    batch_id: string;
    original_file_name: string;
    storage_bucket: string;
    storage_key: string;
    artifact_uri: string | null;
    purge_requested_by_user_id: string | null;
  }>(
    `
      SELECT
        "id",
        "batch_id",
        "original_file_name",
        "storage_bucket",
        "storage_key",
        "artifact_uri",
        "purge_requested_by_user_id"
      FROM "intake_files"
      WHERE "id" = $1::uuid
    `,
    [uploadId],
  );
  const file = fileResult.rows.at(0);
  if (!file) {
    throw new Error("Upload purge target was not found.");
  }

  const [resultsResult, jobsResult] = await Promise.all([
    client.query<{ id: number }>(
      `SELECT "id" FROM "document_results" WHERE "upload_id" = $1::uuid`,
      [uploadId],
    ),
    client.query<{ job_id: string }>(
      `SELECT "job_id" FROM "worker_jobs" WHERE "upload_id" = $1::uuid`,
      [uploadId],
    ),
  ]);
  const objectKeys = new Set<string>();
  if (file.storage_bucket === bucket) {
    for (const value of [file.storage_key, file.artifact_uri]) {
      const key = normalizeObjectKey(value, bucket);
      if (key) objectKeys.add(key);
    }
  }

  const documentResultIds = resultsResult.rows.map((row) => row.id);
  let certificateIds: number[] = [];
  if (documentResultIds.length > 0) {
    const [certificateResult, artifactResult] = await Promise.all([
      client.query<{ id: number }>(
        `
          SELECT "id"
          FROM "extracted_certificates"
          WHERE "document_result_id" = ANY($1::int[])
        `,
        [documentResultIds],
      ),
      client.query<{ bucket: string; key: string }>(
        `
          SELECT "bucket", "key"
          FROM "result_artifacts"
          WHERE "document_result_id" = ANY($1::int[])
        `,
        [documentResultIds],
      ),
    ]);
    certificateIds = certificateResult.rows.map((row) => row.id);
    for (const artifact of artifactResult.rows) {
      if (artifact.bucket === bucket && artifact.key.trim()) {
        objectKeys.add(artifact.key.trim());
      }
    }
  }

  if (certificateIds.length > 0) {
    const signedArtifacts = await client.query<{
      source_pdf_key: string;
      signed_pdf_key: string | null;
    }>(
      `
        SELECT "source_pdf_key", "signed_pdf_key"
        FROM "certificate_signed_artifacts"
        WHERE "certificate_id" = ANY($1::int[])
      `,
      [certificateIds],
    );
    for (const artifact of signedArtifacts.rows) {
      for (const value of [artifact.source_pdf_key, artifact.signed_pdf_key]) {
        const key = normalizeObjectKey(value, bucket);
        if (key) objectKeys.add(key);
      }
    }
  }

  return {
    uploadId,
    batchId: file.batch_id,
    fileName: file.original_file_name,
    requestedByUserId: file.purge_requested_by_user_id,
    documentResultIds,
    certificateIds,
    workerJobIds: jobsResult.rows.map((row) => row.job_id),
    objectKeys: Array.from(objectKeys),
  };
}

async function getBatchPurgeProtection(client: PoolClient, batchId: string) {
  const result = await client.query<{
    has_signed: boolean;
    has_merge: boolean;
    has_file_purge: boolean;
  }>(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM "document_results" dr
          INNER JOIN "extracted_certificates" ec
            ON ec."document_result_id" = dr."id"
          INNER JOIN "certificate_signed_artifacts" sa
            ON sa."certificate_id" = ec."id" AND sa."status" = 'signed'
          WHERE dr."batch_id" = $1::uuid
        ) AS "has_signed",
        (
          EXISTS (
            SELECT 1
            FROM "document_results" dr
            INNER JOIN "extracted_certificates" ec
              ON ec."document_result_id" = dr."id"
            INNER JOIN "certificate_merge_job_inputs" mi
              ON mi."certificate_id" = ec."id"
            WHERE dr."batch_id" = $1::uuid
          ) OR EXISTS (
            SELECT 1 FROM "certificate_merge_job_batches"
            WHERE "batch_id" = $1::uuid
          )
        ) AS "has_merge",
        EXISTS (
          SELECT 1 FROM "intake_files"
          WHERE "batch_id" = $1::uuid AND "purge_status" IS NOT NULL
        ) AS "has_file_purge"
    `,
    [batchId],
  );
  return (
    result.rows.at(0) ?? {
      has_signed: false,
      has_merge: false,
      has_file_purge: false,
    }
  );
}

async function getUploadPurgeProtection(client: PoolClient, uploadId: string) {
  const result = await client.query<{
    has_signed: boolean;
    has_merge: boolean;
    batch_deleted: boolean;
  }>(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM "document_results" dr
          INNER JOIN "extracted_certificates" ec
            ON ec."document_result_id" = dr."id"
          INNER JOIN "certificate_signed_artifacts" sa
            ON sa."certificate_id" = ec."id" AND sa."status" = 'signed'
          WHERE dr."upload_id" = $1::uuid
        ) AS "has_signed",
        EXISTS (
          SELECT 1
          FROM "document_results" dr
          INNER JOIN "extracted_certificates" ec
            ON ec."document_result_id" = dr."id"
          INNER JOIN "certificate_merge_job_inputs" mi
            ON mi."certificate_id" = ec."id"
          WHERE dr."upload_id" = $1::uuid
        ) AS "has_merge",
        EXISTS (
          SELECT 1
          FROM "intake_files" f
          INNER JOIN "intake_batches" b ON b."id" = f."batch_id"
          WHERE f."id" = $1::uuid AND b."deleted_at" IS NOT NULL
        ) AS "batch_deleted"
    `,
    [uploadId],
  );
  return (
    result.rows.at(0) ?? {
      has_signed: false,
      has_merge: false,
      batch_deleted: false,
    }
  );
}

export async function purgeBatchRows(
  client: PoolClient,
  state: BatchPurgeState,
  purgedAt: Date,
  cleanupStats: VersionedS3CleanupStats,
) {
  await client.query("BEGIN");

  try {
    if (state.mergeJobIds.length > 0) {
      await client.query(
        `
          DELETE FROM "certificate_merge_jobs"
          WHERE "id" = ANY($1::uuid[])
        `,
        [state.mergeJobIds],
      );
    }

    if (state.workerJobIds.length > 0) {
      await client.query(
        `
          DELETE FROM "worker_job_steps"
          WHERE "job_id" = ANY($1::text[])
        `,
        [state.workerJobIds],
      );
      await client.query(
        `
          DELETE FROM "worker_idempotency"
          WHERE "job_id" = ANY($1::text[])
        `,
        [state.workerJobIds],
      );
    }

    if (state.certificateIds.length > 0) {
      await client.query(
        `
          UPDATE "reconciliation_results"
          SET
            "matched_certificate_id" = NULL,
            "matched_upload_batch_id" = NULL,
            "archived_at" = $2,
            "updated_at" = $2
          WHERE
            "matched_certificate_id" = ANY($1::int[])
            OR "matched_upload_batch_id" = $3::uuid
            OR "upload_batch_id" = $3::uuid
        `,
        [state.certificateIds, purgedAt, state.batchId],
      );
    } else {
      await client.query(
        `
          UPDATE "reconciliation_results"
          SET
            "matched_upload_batch_id" = NULL,
            "archived_at" = $1,
            "updated_at" = $1
          WHERE
            "matched_upload_batch_id" = $2::uuid
            OR "upload_batch_id" = $2::uuid
        `,
        [purgedAt, state.batchId],
      );
    }

    await client.query(
      `
        DELETE FROM "sales_report_run_batches"
        WHERE "batch_id" = $1::uuid
      `,
      [state.batchId],
    );
    await client.query(
      `
        DELETE FROM "certificate_merge_job_batches"
        WHERE "batch_id" = $1::uuid
      `,
      [state.batchId],
    );
    await client.query(
      `
        DELETE FROM "batch_stage_timings"
        WHERE "batch_id" = $1::uuid
      `,
      [state.batchId],
    );
    await client.query(
      `
        DELETE FROM "intake_batches"
        WHERE "id" = $1::uuid
      `,
      [state.batchId],
    );
    await client.query(
      `
        INSERT INTO "security_audit_logs" (
          "eventType",
          "targetId",
          "targetType",
          "metadata"
        )
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [
        "batch_purged",
        state.batchId,
        "batch",
        JSON.stringify({
          purgedAt: purgedAt.toISOString(),
          objectKeyCount: state.objectKeys.length,
          objectVersionCount: cleanupStats.objectVersionCount,
          deleteMarkerCount: cleanupStats.deleteMarkerCount,
          versionByteCount: cleanupStats.versionByteCount,
        }),
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function purgeUploadRows(
  client: PoolClient,
  state: UploadPurgeState,
  purgedAt: Date,
  cleanupStats: VersionedS3CleanupStats,
) {
  await client.query("BEGIN");

  try {
    if (state.workerJobIds.length > 0) {
      await client.query(
        `DELETE FROM "worker_job_steps" WHERE "job_id" = ANY($1::text[])`,
        [state.workerJobIds],
      );
      await client.query(
        `DELETE FROM "worker_idempotency" WHERE "job_id" = ANY($1::text[])`,
        [state.workerJobIds],
      );
    }

    if (state.certificateIds.length > 0) {
      await client.query(
        `
          WITH affected AS (
            SELECT DISTINCT rr."id"
            FROM "reconciliation_results" rr
            LEFT JOIN "reconciliation_result_collections" rc
              ON rc."reconciliation_result_id" = rr."id"
            WHERE rr."matched_certificate_id" = ANY($1::int[])
               OR rc."certificate_id" = ANY($1::int[])
          )
          UPDATE "reconciliation_results" rr
          SET
            "matched_certificate_id" = NULL,
            "archived_at" = $2,
            "updated_at" = $2
          WHERE rr."id" IN (SELECT "id" FROM affected)
        `,
        [state.certificateIds, purgedAt],
      );
    }

    await client.query(`DELETE FROM "intake_files" WHERE "id" = $1::uuid`, [
      state.uploadId,
    ]);
    await client.query(
      `
        UPDATE "intake_batches"
        SET
          "total_files" = (
            SELECT count(*)::int
            FROM "intake_files"
            WHERE "batch_id" = $1::uuid
              AND "removed_from_batch_at" IS NULL
          ),
          "last_activity_at" = $2,
          "updated_at" = $2
        WHERE "id" = $1::uuid
      `,
      [state.batchId, purgedAt],
    );
    await client.query(
      `
        INSERT INTO "security_audit_logs" (
          "eventType",
          "actorUserId",
          "targetId",
          "targetType",
          "metadata"
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        "document_purged",
        state.requestedByUserId,
        state.uploadId,
        "document",
        JSON.stringify({
          purgedAt: purgedAt.toISOString(),
          batchId: state.batchId,
          fileName: state.fileName,
          certificateIds: state.certificateIds,
          objectKeyCount: state.objectKeys.length,
          objectVersionCount: cleanupStats.objectVersionCount,
          deleteMarkerCount: cleanupStats.deleteMarkerCount,
          versionByteCount: cleanupStats.versionByteCount,
        }),
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

type BatchRetentionLogRecord = BatchRetentionSummary & {
  event: "batch_retention_attempt";
  outcome: "purged" | "failed";
  versionTargetCount: number;
  failureCount: 0 | 1;
  failurePhase?: BatchRetentionFailurePhase;
  failedVersionDeleteCount: number;
  remainingVersionTargetCount: number;
  errorClass?: string;
  errorMessage?: string;
};

type BatchRetentionDependencies = {
  collectBatchPurgeState: typeof collectBatchPurgeState;
  deleteVersionedS3Objects: typeof deleteVersionedS3Objects;
  getBatchPurgeProtection: typeof getBatchPurgeProtection;
  purgeBatchRows: typeof purgeBatchRows;
  logOutcome: (record: BatchRetentionLogRecord) => void;
};

const defaultDependencies: BatchRetentionDependencies = {
  collectBatchPurgeState,
  deleteVersionedS3Objects,
  getBatchPurgeProtection,
  purgeBatchRows,
  logOutcome: (record) => {
    if (record.outcome === "failed") {
      console.error(record);
      return;
    }
    console.info(record);
  },
};

function retryAgeSeconds(now: Date, purgeAfterAt: Date | string): number {
  const purgeAfter =
    purgeAfterAt instanceof Date ? purgeAfterAt : new Date(purgeAfterAt);
  if (Number.isNaN(purgeAfter.getTime())) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - purgeAfter.getTime()) / 1000));
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizedFailureMessage(error: unknown): string {
  const message = errorMessage(error)
    .replace(/s3:\/\/[^\s]+/gi, "storage object")
    .replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .trim();
  return (message || "Permanent deletion failed. Please retry.").slice(0, 500);
}

async function claimBatchPurge(
  client: PoolClient,
  batchId: string,
  now: Date,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `
      UPDATE "intake_batches"
      SET
        "purge_status" = 'running',
        "purge_started_at" = $2::timestamptz,
        "purge_error" = NULL,
        "updated_at" = $2::timestamptz
      WHERE "id" = $1::uuid
        AND "deleted_at" IS NOT NULL
        AND (
          "purge_status" IS NULL
          OR "purge_status" IN ('scheduled', 'queued', 'failed')
          OR (
            "purge_status" = 'running'
            AND COALESCE("purge_started_at", "purge_requested_at", "updated_at")
              <= $2::timestamptz - INTERVAL '15 minutes'
          )
        )
      RETURNING "id"
    `,
    [batchId, now],
  );
  return result.rows.length > 0;
}

async function markBatchPurgeStatus(
  client: PoolClient,
  batchId: string,
  status: "failed" | "blocked",
  error: string,
  now: Date,
) {
  await client.query(
    `
      UPDATE "intake_batches"
      SET
        "purge_status" = $2,
        "purge_error" = $3,
        "updated_at" = $4
      WHERE "id" = $1::uuid
    `,
    [batchId, status, error.slice(0, 500), now],
  );
}

async function claimUploadPurge(
  client: PoolClient,
  uploadId: string,
  now: Date,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `
      UPDATE "intake_files"
      SET
        "purge_status" = 'running',
        "purge_started_at" = $2::timestamptz,
        "purge_error" = NULL,
        "updated_at" = $2::timestamptz
      WHERE "id" = $1::uuid
        AND (
          "purge_status" IN ('queued', 'failed')
          OR (
            "purge_status" = 'running'
            AND COALESCE("purge_started_at", "purge_requested_at", "updated_at")
              <= $2::timestamptz - INTERVAL '15 minutes'
          )
        )
      RETURNING "id"
    `,
    [uploadId, now],
  );
  return result.rows.length > 0;
}

async function markUploadPurgeStatus(
  client: PoolClient,
  uploadId: string,
  status: "failed" | "blocked",
  error: string,
  now: Date,
) {
  await client.query(
    `
      UPDATE "intake_files"
      SET
        "purge_status" = $2,
        "purge_error" = $3,
        "updated_at" = $4
      WHERE "id" = $1::uuid
    `,
    [uploadId, status, error.slice(0, 500), now],
  );
}

function logOutcome(
  dependencies: BatchRetentionDependencies,
  input: Omit<BatchRetentionLogRecord, "event" | "versionTargetCount">,
) {
  dependencies.logOutcome({
    event: "batch_retention_attempt",
    versionTargetCount: input.objectVersionCount + input.deleteMarkerCount,
    ...input,
  });
}

export async function runBatchRetention(
  input: {
    client: PoolClient;
    s3: S3Client;
    bucket: string;
    now: Date;
    limit: number;
    batchId?: string;
  },
  dependencyOverrides: Partial<BatchRetentionDependencies> = {},
): Promise<BatchRetentionResponse> {
  const dependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
  };
  const batchesResult = input.batchId
    ? await input.client.query<{
        id: string;
        purge_after_at: Date | string;
      }>(
        `
          SELECT "id", COALESCE("purge_after_at", $2::timestamptz) AS "purge_after_at"
          FROM "intake_batches"
          WHERE "id" = $1::uuid AND "deleted_at" IS NOT NULL
          LIMIT 1
        `,
        [input.batchId, input.now],
      )
    : await input.client.query<{
        id: string;
        purge_after_at: Date | string;
      }>(
        `
          SELECT "id", "purge_after_at"
          FROM "intake_batches"
          WHERE "deleted_at" IS NOT NULL
            AND "purge_after_at" <= $1::timestamptz
            AND (
              "purge_status" IS NULL
              OR "purge_status" IN ('scheduled', 'queued', 'failed')
              OR (
                "purge_status" = 'running'
                AND COALESCE("purge_started_at", "purge_requested_at", "updated_at")
                  <= $1::timestamptz - INTERVAL '15 minutes'
              )
            )
          ORDER BY "purge_after_at" ASC, "deleted_at" ASC
          LIMIT $2
        `,
        [input.now, input.limit],
      );
  const response: BatchRetentionResponse = {
    purged: [],
    failed: [],
  };

  for (const batch of batchesResult.rows) {
    if (!(await claimBatchPurge(input.client, batch.id, input.now))) {
      continue;
    }

    const batchRetryAgeSeconds = retryAgeSeconds(
      input.now,
      batch.purge_after_at,
    );
    let state: BatchPurgeState | undefined;
    let cleanupStats = emptyVersionedS3CleanupStats();

    try {
      const protection = await dependencies.getBatchPurgeProtection(
        input.client,
        batch.id,
      );
      if (
        protection.has_signed ||
        protection.has_merge ||
        protection.has_file_purge
      ) {
        const reason = protection.has_signed
          ? "This batch contains a signed certificate and cannot be permanently deleted."
          : protection.has_merge
            ? "This batch contains a certificate used by a merge job and cannot be permanently deleted."
            : "This batch has an incomplete file deletion and cannot be permanently deleted.";
        await markBatchPurgeStatus(
          input.client,
          batch.id,
          "blocked",
          reason,
          input.now,
        );
        continue;
      }

      state = await dependencies.collectBatchPurgeState(
        input.client,
        batch.id,
        input.bucket,
      );
      cleanupStats = await dependencies.deleteVersionedS3Objects(
        input.s3,
        input.bucket,
        state.objectKeys,
      );
      await dependencies.purgeBatchRows(
        input.client,
        state,
        input.now,
        cleanupStats,
      );

      const summary: BatchRetentionSummary = {
        batchId: batch.id,
        objectKeyCount: state.objectKeys.length,
        ...cleanupStats,
        retryAgeSeconds: batchRetryAgeSeconds,
      };
      response.purged.push(summary);
      logOutcome(dependencies, {
        ...summary,
        outcome: "purged",
        failureCount: 0,
        failedVersionDeleteCount: 0,
        remainingVersionTargetCount: 0,
      });
    } catch (error) {
      await markBatchPurgeStatus(
        input.client,
        batch.id,
        "failed",
        sanitizedFailureMessage(error),
        input.now,
      );
      const cleanupError =
        error instanceof VersionedS3CleanupError ? error : undefined;
      cleanupStats = cleanupError?.stats ?? cleanupStats;
      const failure: FailedBatchRetentionSummary = {
        batchId: batch.id,
        objectKeyCount: state?.objectKeys.length ?? 0,
        ...cleanupStats,
        retryAgeSeconds: batchRetryAgeSeconds,
        failurePhase: cleanupError?.phase ?? "purge_database",
        failedVersionDeleteCount: cleanupError?.failedVersionDeleteCount ?? 0,
        remainingVersionTargetCount:
          cleanupError?.remainingVersionTargetCount ?? 0,
      };
      response.failed.push(failure);
      logOutcome(dependencies, {
        ...failure,
        outcome: "failed",
        failureCount: 1,
        errorClass: errorClass(error),
        errorMessage: errorMessage(error),
      });
    }
  }

  return response;
}

type UploadRetentionDependencies = {
  collectUploadPurgeState: typeof collectUploadPurgeState;
  deleteVersionedS3Objects: typeof deleteVersionedS3Objects;
  getUploadPurgeProtection: typeof getUploadPurgeProtection;
  purgeUploadRows: typeof purgeUploadRows;
};

const defaultUploadDependencies: UploadRetentionDependencies = {
  collectUploadPurgeState,
  deleteVersionedS3Objects,
  getUploadPurgeProtection,
  purgeUploadRows,
};

export async function runUploadRetention(
  input: {
    client: PoolClient;
    s3: S3Client;
    bucket: string;
    now: Date;
    limit: number;
    uploadId?: string;
  },
  dependencyOverrides: Partial<UploadRetentionDependencies> = {},
): Promise<Pick<BatchRetentionResponse, "uploadPurged" | "uploadFailed">> {
  const dependencies = {
    ...defaultUploadDependencies,
    ...dependencyOverrides,
  };
  const candidates = input.uploadId
    ? await input.client.query<{ id: string }>(
        `SELECT "id" FROM "intake_files" WHERE "id" = $1::uuid LIMIT 1`,
        [input.uploadId],
      )
    : await input.client.query<{ id: string }>(
        `
          SELECT "id"
          FROM "intake_files"
          WHERE "purge_status" IN ('queued', 'failed')
             OR (
               "purge_status" = 'running'
               AND COALESCE("purge_started_at", "purge_requested_at", "updated_at")
                 <= $1::timestamptz - INTERVAL '15 minutes'
             )
          ORDER BY COALESCE("purge_requested_at", "updated_at") ASC
          LIMIT $2
        `,
        [input.now, input.limit],
      );
  const response: Pick<
    BatchRetentionResponse,
    "uploadPurged" | "uploadFailed"
  > = { uploadPurged: [], uploadFailed: [] };

  for (const candidate of candidates.rows) {
    if (!(await claimUploadPurge(input.client, candidate.id, input.now))) {
      continue;
    }

    let state: UploadPurgeState | undefined;
    let cleanupStats = emptyVersionedS3CleanupStats();
    try {
      const protection = await dependencies.getUploadPurgeProtection(
        input.client,
        candidate.id,
      );
      if (
        protection.has_signed ||
        protection.has_merge ||
        protection.batch_deleted
      ) {
        const reason = protection.has_signed
          ? "This document has a signed certificate and cannot be permanently deleted."
          : protection.has_merge
            ? "This document has a certificate used by a merge job and cannot be permanently deleted."
            : "Restore the batch before deleting an individual document.";
        await markUploadPurgeStatus(
          input.client,
          candidate.id,
          "blocked",
          reason,
          input.now,
        );
        continue;
      }

      state = await dependencies.collectUploadPurgeState(
        input.client,
        candidate.id,
        input.bucket,
      );
      cleanupStats = await dependencies.deleteVersionedS3Objects(
        input.s3,
        input.bucket,
        state.objectKeys,
      );
      await dependencies.purgeUploadRows(
        input.client,
        state,
        input.now,
        cleanupStats,
      );
      response.uploadPurged?.push({
        uploadId: candidate.id,
        batchId: state.batchId,
        objectKeyCount: state.objectKeys.length,
        ...cleanupStats,
      });
    } catch (error) {
      await markUploadPurgeStatus(
        input.client,
        candidate.id,
        "failed",
        sanitizedFailureMessage(error),
        input.now,
      );
      const cleanupError =
        error instanceof VersionedS3CleanupError ? error : undefined;
      cleanupStats = cleanupError?.stats ?? cleanupStats;
      response.uploadFailed?.push({
        uploadId: candidate.id,
        batchId: state?.batchId ?? "",
        objectKeyCount: state?.objectKeys.length ?? 0,
        ...cleanupStats,
        failurePhase: cleanupError?.phase ?? "purge_database",
        failedVersionDeleteCount: cleanupError?.failedVersionDeleteCount ?? 0,
        remainingVersionTargetCount:
          cleanupError?.remainingVersionTargetCount ?? 0,
      });
      console.error({
        event: "upload_retention_attempt",
        uploadId: candidate.id,
        outcome: "failed",
        errorClass: errorClass(error),
        errorMessage: sanitizedFailureMessage(error),
      });
    }
  }

  return response;
}

export const handler = async (
  event: BatchRetentionEvent = {},
): Promise<BatchRetentionResponse> => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const bucket = process.env.S3_BUCKET_NAME?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for batch retention purge.");
  }
  if (!bucket) {
    throw new Error("S3_BUCKET_NAME is required for batch retention purge.");
  }

  const now = event.now ? new Date(event.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Batch retention event now value is not a valid date.");
  }

  const limit = Math.max(1, Math.min(event.limit ?? defaultLimit, 100));
  const pool = new Pool({
    connectionString: toNodePgConnectionString(databaseUrl),
    ssl: shouldUseSsl(databaseUrl)
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });
  const s3 = new S3Client({
    region: process.env.AWS_REGION ?? defaultRegion,
  });

  try {
    const client = await pool.connect();

    try {
      if (event.targetType === "batch" && event.targetId) {
        return await runBatchRetention({
          client,
          s3,
          bucket,
          now,
          limit: 1,
          batchId: event.targetId,
        });
      }
      if (event.targetType === "upload" && event.targetId) {
        const uploadResponse = await runUploadRetention({
          client,
          s3,
          bucket,
          now,
          limit: 1,
          uploadId: event.targetId,
        });
        return { purged: [], failed: [], ...uploadResponse };
      }

      const batchResponse = await runBatchRetention({
        client,
        s3,
        bucket,
        now,
        limit,
      });
      const uploadResponse = await runUploadRetention({
        client,
        s3,
        bucket,
        now,
        limit,
      });
      return { ...batchResponse, ...uploadResponse };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
};
