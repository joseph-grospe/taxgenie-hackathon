import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import type { PoolClient } from "pg";

type BatchRetentionEvent = {
  now?: string;
  limit?: number;
};

type BatchRetentionResponse = {
  purged: Array<{
    batchId: string;
    objectKeyCount: number;
    failedObjectDeleteCount: number;
  }>;
};

type DocumentResultRow = {
  id: number;
  final_key: string | null;
  artifact_key: string | null;
  payload: unknown;
};

type BatchPurgeState = {
  batchId: string;
  resultIds: number[];
  mergeJobIds: string[];
  workerJobIds: string[];
  objectKeys: string[];
};

const defaultRegion = "ap-southeast-1";
const defaultLimit = 25;
const deleteObjectChunkSize = 1000;

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

function collectArtifactKeyValues(
  value: unknown,
  bucket: string,
  keys: Set<string>,
) {
  const key = normalizeObjectKey(value, bucket);
  if (key) {
    keys.add(key);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactKeyValues(item, bucket, keys);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectArtifactKeyValues(item, bucket, keys);
    }
  }
}

function collectArtifactKeysFromPayload(
  value: unknown,
  bucket: string,
  keys: Set<string>,
) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactKeysFromPayload(item, bucket, keys);
    }
    return;
  }

  for (const [property, propertyValue] of Object.entries(value)) {
    if (property === "artifactKeys") {
      collectArtifactKeyValues(propertyValue, bucket, keys);
      continue;
    }

    if (property === "source" && Array.isArray(propertyValue)) {
      collectArtifactKeyValues(propertyValue, bucket, keys);
      continue;
    }

    const key = [
      "source",
      "rawResultJson",
      "finalResultJson",
      "renamedPdf",
    ].includes(property)
      ? normalizeObjectKey(propertyValue, bucket)
      : null;

    if (key) {
      keys.add(key);
    }

    if (propertyValue && typeof propertyValue === "object") {
      collectArtifactKeysFromPayload(propertyValue, bucket, keys);
    }
  }
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function collectBatchPurgeState(
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
    client.query<DocumentResultRow>(
      `
        SELECT "id", "final_key", "artifact_key", "payload"
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

  for (const result of resultsResult.rows) {
    for (const value of [result.final_key, result.artifact_key]) {
      const key = normalizeObjectKey(value, bucket);
      if (key) {
        objectKeys.add(key);
      }
    }
    collectArtifactKeysFromPayload(result.payload, bucket, objectKeys);
  }

  const resultIds = resultsResult.rows.map((result) => result.id);
  let mergeJobIds: string[] = [];

  if (resultIds.length > 0) {
    const [signedArtifactsResult, mergeInputsResult] = await Promise.all([
      client.query<{ source_pdf_key: string; signed_pdf_key: string | null }>(
        `
          SELECT "source_pdf_key", "signed_pdf_key"
          FROM "certificate_signed_artifacts"
          WHERE "document_result_id" = ANY($1::int[])
        `,
        [resultIds],
      ),
      client.query<{ merge_job_id: string }>(
        `
          SELECT "merge_job_id"
          FROM "certificate_merge_job_inputs"
          WHERE "document_result_id" = ANY($1::int[])
        `,
        [resultIds],
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
    resultIds,
    mergeJobIds,
    workerJobIds: jobsResult.rows.map((job) => job.job_id),
    objectKeys: Array.from(objectKeys),
  };
}

async function deleteS3Objects(s3: S3Client, bucket: string, keys: string[]) {
  let failedObjectDeleteCount = 0;

  for (const chunk of chunkItems(keys, deleteObjectChunkSize)) {
    try {
      const response = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      failedObjectDeleteCount += response.Errors?.length ?? 0;
    } catch (error) {
      failedObjectDeleteCount += chunk.length;
      console.error("Failed to delete S3 objects for purged batch.", {
        bucket,
        objectCount: chunk.length,
        error,
      });
    }
  }

  return failedObjectDeleteCount;
}

async function purgeBatchRows(
  client: PoolClient,
  state: BatchPurgeState,
  purgedAt: Date,
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

    if (state.resultIds.length > 0) {
      await client.query(
        `
          UPDATE "reconciliation_results"
          SET
            "matched_tax_record_id" = NULL,
            "matched_upload_batch_id" = NULL,
            "archived_at" = $2,
            "updated_at" = $2
          WHERE
            "matched_tax_record_id" = ANY($1::int[])
            OR "matched_upload_batch_id" = $3::uuid
            OR "upload_batch_id" = $3::uuid
        `,
        [state.resultIds, purgedAt, state.batchId],
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
        }),
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
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
      const batchesResult = await client.query<{ id: string }>(
        `
          SELECT "id"
          FROM "intake_batches"
          WHERE "deleted_at" IS NOT NULL
            AND "purge_after_at" <= $1
          ORDER BY "purge_after_at" ASC, "deleted_at" ASC
          LIMIT $2
        `,
        [now, limit],
      );
      const purged: BatchRetentionResponse["purged"] = [];

      for (const batch of batchesResult.rows) {
        const state = await collectBatchPurgeState(client, batch.id, bucket);
        const failedObjectDeleteCount = await deleteS3Objects(
          s3,
          bucket,
          state.objectKeys,
        );

        await purgeBatchRows(client, state, now);
        purged.push({
          batchId: batch.id,
          objectKeyCount: state.objectKeys.length,
          failedObjectDeleteCount,
        });
      }

      return { purged };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
};
