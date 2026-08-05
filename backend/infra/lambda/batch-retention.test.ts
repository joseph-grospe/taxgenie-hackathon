import type { S3Client } from "@aws-sdk/client-s3";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  collectBatchPurgeState,
  purgeBatchRows,
  runBatchRetention,
  runUploadRetention,
  type BatchPurgeState,
  type UploadPurgeState,
} from "./batch-retention";
import {
  VersionedS3CleanupError,
  emptyVersionedS3CleanupStats,
} from "./versioned-s3-retention";

const bucket = "taxtrack-storage";
const now = new Date("2026-06-02T00:00:00.000Z");

function candidateClient(
  rows: Array<{ id: string; purge_after_at: Date | string }>,
): PoolClient {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as PoolClient;
}

function unusedS3Client(): S3Client {
  return { send: vi.fn() } as unknown as S3Client;
}

function batchState(batchId: string, key: string): BatchPurgeState {
  return {
    batchId,
    documentResultIds: [],
    certificateIds: [],
    mergeJobIds: [],
    workerJobIds: [],
    objectKeys: [key],
  };
}

describe("collectBatchPurgeState", () => {
  it("collects relational certificate artifacts without inspecting extraction payloads", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM "intake_files"')) {
        return {
          rows: [
            {
              storage_key: "uploads/source.pdf",
              artifact_uri: "s3://taxtrack-storage/uploads/source.pdf",
            },
          ],
        };
      }
      if (sql.includes('FROM "document_results"')) {
        return { rows: [{ id: 10 }] };
      }
      if (sql.includes('FROM "worker_jobs"')) {
        return { rows: [{ job_id: "job-1" }] };
      }
      if (sql.includes('FROM "extracted_certificates"')) {
        return { rows: [{ id: 20 }, { id: 21 }] };
      }
      if (sql.includes('FROM "result_artifacts"')) {
        return {
          rows: [
            {
              bucket: "taxtrack-storage",
              key: "results/certificate-20.pdf",
            },
            { bucket: "other-bucket", key: "ignored.pdf" },
          ],
        };
      }
      if (sql.includes('FROM "certificate_signed_artifacts"')) {
        return {
          rows: [
            {
              source_pdf_key: "results/certificate-20.pdf",
              signed_pdf_key: "signed/certificate-20.pdf",
            },
          ],
        };
      }
      if (sql.includes('FROM "certificate_merge_job_inputs"')) {
        return { rows: [{ merge_job_id: "merge-1" }] };
      }
      if (sql.includes('FROM "certificate_merge_job_outputs"')) {
        return { rows: [{ output_key: "merged/output.pdf" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const client = { query } as unknown as PoolClient;

    const state = await collectBatchPurgeState(client, "batch-a", bucket);

    expect(state).toEqual({
      batchId: "batch-a",
      documentResultIds: [10],
      certificateIds: [20, 21],
      mergeJobIds: ["merge-1"],
      workerJobIds: ["job-1"],
      objectKeys: [
        "uploads/source.pdf",
        "results/certificate-20.pdf",
        "signed/certificate-20.pdf",
        "merged/output.pdf",
      ],
    });
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('"payload"')),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        /"artifact_key"|"final_key"/u.test(String(sql)),
      ),
    ).toBe(false);
  });
});

describe("runBatchRetention", () => {
  it("casts targeted and stale-claim timestamps as timestamptz", async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('SELECT "id", COALESCE("purge_after_at"')) {
        return {
          rows: [
            {
              id: "batch-a",
              purge_after_at: "2026-06-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (statement.includes('UPDATE "intake_batches"')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    const client = { query } as unknown as PoolClient;

    await runBatchRetention({
      client,
      s3: unusedS3Client(),
      bucket,
      now,
      limit: 1,
      batchId: "batch-a",
    });

    expect(String(query.mock.calls[0]?.[0])).toContain(
      'COALESCE("purge_after_at", $2::timestamptz)',
    );
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "<= $2::timestamptz - INTERVAL '15 minutes'",
    );
  });

  it("marks protected legacy batches as blocked without deleting storage", async () => {
    const client = candidateClient([
      { id: "batch-a", purge_after_at: "2026-06-01T00:00:00.000Z" },
    ]);
    const collectState = vi.fn();
    const deleteVersions = vi.fn();

    const response = await runBatchRetention(
      { client, s3: unusedS3Client(), bucket, now, limit: 25 },
      {
        collectBatchPurgeState: collectState,
        deleteVersionedS3Objects: deleteVersions,
        getBatchPurgeProtection: vi.fn().mockResolvedValue({
          has_signed: true,
          has_merge: false,
          has_file_purge: false,
        }),
      },
    );

    expect(response).toEqual({ purged: [], failed: [] });
    expect(collectState).not.toHaveBeenCalled();
    expect(deleteVersions).not.toHaveBeenCalled();
    const statements = vi
      .mocked(client.query)
      .mock.calls.map(([statement]) => String(statement));
    expect(statements[0]).toContain('"purge_after_at" <= $1::timestamptz');
    expect(statements[0]).toContain(
      "<= $1::timestamptz - INTERVAL '15 minutes'",
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('"purge_status" = $2'),
      [
        "batch-a",
        "blocked",
        expect.stringContaining("signed certificate"),
        now,
      ],
    );
  });

  it("keeps a failed batch manifest and continues purging later batches", async () => {
    const client = candidateClient([
      { id: "batch-a", purge_after_at: "2026-06-01T00:00:00.000Z" },
      { id: "batch-b", purge_after_at: "2026-06-01T12:00:00.000Z" },
    ]);
    const states = new Map([
      ["batch-a", batchState("batch-a", "uploads/a.pdf")],
      ["batch-b", batchState("batch-b", "uploads/b.pdf")],
    ]);
    const collectState = vi.fn(
      async (_client: PoolClient, batchId: string) => states.get(batchId)!,
    );
    const deleteVersions = vi.fn(async (_s3, _bucket, keys: string[]) => {
      if (keys[0] === "uploads/a.pdf") {
        throw new VersionedS3CleanupError("delete failed", {
          phase: "delete_versions",
          stats: {
            objectVersionCount: 2,
            deleteMarkerCount: 1,
            versionByteCount: 30,
          },
          failedVersionDeleteCount: 1,
        });
      }
      return {
        objectVersionCount: 1,
        deleteMarkerCount: 1,
        versionByteCount: 20,
      };
    });
    const purgeRows = vi.fn();
    const log = vi.fn();

    const response = await runBatchRetention(
      { client, s3: unusedS3Client(), bucket, now, limit: 25 },
      {
        collectBatchPurgeState: collectState,
        deleteVersionedS3Objects: deleteVersions,
        purgeBatchRows: purgeRows,
        logOutcome: log,
      },
    );

    expect(purgeRows).toHaveBeenCalledTimes(1);
    expect(purgeRows.mock.calls[0]?.[1].batchId).toBe("batch-b");
    expect(response.failed).toEqual([
      expect.objectContaining({
        batchId: "batch-a",
        failurePhase: "delete_versions",
        failedVersionDeleteCount: 1,
        objectVersionCount: 2,
        deleteMarkerCount: 1,
        retryAgeSeconds: 86400,
      }),
    ]);
    expect(response.purged).toEqual([
      expect.objectContaining({
        batchId: "batch-b",
        objectVersionCount: 1,
        deleteMarkerCount: 1,
        retryAgeSeconds: 43200,
      }),
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "batch_retention_attempt",
        batchId: "batch-a",
        outcome: "failed",
        versionTargetCount: 3,
        failureCount: 1,
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-b",
        outcome: "purged",
        versionTargetCount: 2,
        failureCount: 0,
      }),
    );
  });

  it("retries database finalization after S3 cleanup has already succeeded", async () => {
    const client = candidateClient([
      { id: "batch-a", purge_after_at: "2026-06-01T00:00:00.000Z" },
    ]);
    const state = batchState("batch-a", "uploads/a.pdf");
    const collectState = vi.fn().mockResolvedValue(state);
    const deleteVersions = vi
      .fn()
      .mockResolvedValueOnce({
        objectVersionCount: 2,
        deleteMarkerCount: 1,
        versionByteCount: 30,
      })
      .mockResolvedValueOnce(emptyVersionedS3CleanupStats());
    const purgeRows = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(undefined);
    const dependencies = {
      collectBatchPurgeState: collectState,
      deleteVersionedS3Objects: deleteVersions,
      purgeBatchRows: purgeRows,
      logOutcome: vi.fn(),
    };

    const first = await runBatchRetention(
      { client, s3: unusedS3Client(), bucket, now, limit: 25 },
      dependencies,
    );
    const second = await runBatchRetention(
      { client, s3: unusedS3Client(), bucket, now, limit: 25 },
      dependencies,
    );

    expect(first.purged).toEqual([]);
    expect(first.failed[0]).toMatchObject({
      batchId: "batch-a",
      failurePhase: "purge_database",
      objectVersionCount: 2,
      deleteMarkerCount: 1,
    });
    expect(second.failed).toEqual([]);
    expect(second.purged[0]).toMatchObject({
      batchId: "batch-a",
      objectVersionCount: 0,
      deleteMarkerCount: 0,
    });
    expect(purgeRows).toHaveBeenCalledTimes(2);
  });
});

describe("runUploadRetention", () => {
  it("purges a targeted queued upload and returns cleanup counts", async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('SELECT "id" FROM "intake_files"')) {
        return { rows: [{ id: "upload-a" }] };
      }
      if (statement.includes('UPDATE "intake_files"')) {
        return { rows: [{ id: "upload-a" }] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    const client = { query } as unknown as PoolClient;
    const state: UploadPurgeState = {
      uploadId: "upload-a",
      batchId: "batch-a",
      fileName: "source.pdf",
      requestedByUserId: "user-a",
      documentResultIds: [1],
      certificateIds: [2],
      workerJobIds: ["job-a"],
      objectKeys: ["uploads/source.pdf", "results/certificate.pdf"],
    };
    const purgeRows = vi.fn();

    const response = await runUploadRetention(
      {
        client,
        s3: unusedS3Client(),
        bucket,
        now,
        limit: 1,
        uploadId: "upload-a",
      },
      {
        collectUploadPurgeState: vi.fn().mockResolvedValue(state),
        deleteVersionedS3Objects: vi.fn().mockResolvedValue({
          objectVersionCount: 3,
          deleteMarkerCount: 1,
          versionByteCount: 40,
        }),
        getUploadPurgeProtection: vi.fn().mockResolvedValue({
          has_signed: false,
          has_merge: false,
          batch_deleted: false,
        }),
        purgeUploadRows: purgeRows,
      },
    );

    expect(purgeRows).toHaveBeenCalledWith(
      client,
      state,
      now,
      expect.objectContaining({ objectVersionCount: 3 }),
    );
    expect(response.uploadPurged).toEqual([
      expect.objectContaining({
        uploadId: "upload-a",
        batchId: "batch-a",
        objectKeyCount: 2,
        deleteMarkerCount: 1,
      }),
    ]);
    expect(response.uploadFailed).toEqual([]);
    const claimStatement = query.mock.calls
      .map(([statement]) => String(statement))
      .find((statement) => statement.includes('UPDATE "intake_files"'));
    expect(claimStatement).toContain(
      "<= $2::timestamptz - INTERVAL '15 minutes'",
    );
  });
});

describe("purgeBatchRows", () => {
  it("stores successful version cleanup counts in the purge audit event", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return { rows: [] };
      }),
    } as unknown as PoolClient;
    const state = batchState("batch-a", "uploads/a.pdf");

    await purgeBatchRows(client, state, now, {
      objectVersionCount: 2,
      deleteMarkerCount: 1,
      versionByteCount: 30,
    });

    const auditCall = calls.find((call) =>
      call.sql.includes('INSERT INTO "security_audit_logs"'),
    );
    expect(JSON.parse(String(auditCall?.values?.[3]))).toEqual({
      purgedAt: now.toISOString(),
      objectKeyCount: 1,
      objectVersionCount: 2,
      deleteMarkerCount: 1,
      versionByteCount: 30,
    });
    expect(calls.at(-1)?.sql).toBe("COMMIT");
  });

  it("rolls back when database finalization fails", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes('DELETE FROM "intake_batches"')) {
          throw new Error("delete failed");
        }
        return { rows: [] };
      }),
    } as unknown as PoolClient;

    await expect(
      purgeBatchRows(
        client,
        batchState("batch-a", "uploads/a.pdf"),
        now,
        emptyVersionedS3CleanupStats(),
      ),
    ).rejects.toThrow("delete failed");
    expect(calls.at(-1)).toBe("ROLLBACK");
  });
});
