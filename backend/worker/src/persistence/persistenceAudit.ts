import {
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { createLogger } from "@taxtrack/shared";
import { asc } from "drizzle-orm";
import { pathToFileURL } from "node:url";

import type { DbClient } from "../db/client";
import { createDbClient } from "../db/client";
import { documentResults } from "../db/schema";

export interface PersistenceAuditIssue {
  documentResultId: number;
  uploadId: string;
  role: string;
  bucket: string;
  key: string;
  issue: "missing_object" | "invalid_pointer" | "non_signable_final_key";
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parsePointer(
  pointer: string,
  defaultBucket: string,
): { bucket: string; key: string } | null {
  if (!pointer.startsWith("s3://")) {
    return pointer.length > 0 ? { bucket: defaultBucket, key: pointer } : null;
  }
  const path = pointer.slice("s3://".length);
  const separator = path.indexOf("/");
  return separator > 0
    ? { bucket: path.slice(0, separator), key: path.slice(separator + 1) }
    : null;
}

function isNotFound(error: unknown): boolean {
  const value = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    value?.name === "NotFound" ||
    value?.name === "NoSuchKey" ||
    value?.$metadata?.httpStatusCode === 404
  );
}

export async function auditResultPersistencePointers(input: {
  db: DbClient;
  s3: S3Client;
  defaultBucket: string;
  limit?: number;
}): Promise<{
  resultCount: number;
  pointerCount: number;
  issues: PersistenceAuditIssue[];
}> {
  const rows = await input.db
    .select({
      id: documentResults.id,
      uploadId: documentResults.uploadId,
      outcome: documentResults.outcome,
      artifactKey: documentResults.artifactKey,
      finalKey: documentResults.finalKey,
      payload: documentResults.payload,
    })
    .from(documentResults)
    .orderBy(asc(documentResults.id))
    .limit(input.limit ?? 1_000);
  const issues: PersistenceAuditIssue[] = [];
  let pointerCount = 0;

  for (const row of rows) {
    const payloadArtifactKeys = toRecord(toRecord(row.payload).artifactKeys);
    const pointers = new Map<string, string>();
    for (const [role, pointer] of [
      ["artifactKey", row.artifactKey],
      ["finalKey", row.finalKey],
      ...Object.entries(payloadArtifactKeys),
    ] as Array<[string, unknown]>) {
      if (typeof pointer === "string" && pointer.length > 0) {
        pointers.set(role, pointer);
      }
    }

    if (row.outcome !== "Done" && row.finalKey) {
      const parsed = parsePointer(row.finalKey, input.defaultBucket);
      issues.push({
        documentResultId: row.id,
        uploadId: row.uploadId,
        role: "finalKey",
        bucket: parsed?.bucket ?? input.defaultBucket,
        key: parsed?.key ?? row.finalKey,
        issue: "non_signable_final_key",
      });
    }

    for (const [role, pointer] of pointers) {
      pointerCount += 1;
      const parsed = parsePointer(pointer, input.defaultBucket);
      if (!parsed) {
        issues.push({
          documentResultId: row.id,
          uploadId: row.uploadId,
          role,
          bucket: input.defaultBucket,
          key: pointer,
          issue: "invalid_pointer",
        });
        continue;
      }
      try {
        await input.s3.send(
          new HeadObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
        );
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
        issues.push({
          documentResultId: row.id,
          uploadId: row.uploadId,
          role,
          bucket: parsed.bucket,
          key: parsed.key,
          issue: "missing_object",
        });
      }
    }
  }

  return { resultCount: rows.length, pointerCount, issues };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const bucket = process.env.S3_BUCKET_NAME?.trim();
  if (!databaseUrl || !bucket) {
    throw new Error("DATABASE_URL and S3_BUCKET_NAME are required.");
  }
  const limit = Number(process.env.PERSISTENCE_AUDIT_LIMIT ?? 1_000);
  const { db, pool } = createDbClient(databaseUrl);
  const s3Config: S3ClientConfig = { region: process.env.AWS_REGION };
  const logger = createLogger({ component: "persistence-audit" });
  try {
    const result = await auditResultPersistencePointers({
      db,
      s3: new S3Client(s3Config),
      defaultBucket: bucket,
      limit,
    });
    logger.info("persistence_pointer_audit_completed", {
      resultCount: result.resultCount,
      pointerCount: result.pointerCount,
      issueCount: result.issues.length,
      issues: result.issues,
    });
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
