import type { S3Client } from "@aws-sdk/client-s3";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  purgeBatchRows,
  runBatchRetention,
  type BatchPurgeState,
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
    resultIds: [],
    mergeJobIds: [],
    workerJobIds: [],
    objectKeys: [key],
  };
}

describe("runBatchRetention", () => {
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
