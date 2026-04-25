import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DbClient } from "../../db/client";
import { documentResults } from "../../db/schema";
import type { WorkflowState } from "../types";
import {
  buildBatchDataFingerprint,
  buildNormalizedDataFingerprint,
} from "../utils/dedupe";

interface PersistValidationFailDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
}

function reasonKey(state: WorkflowState): string {
  return `errors/${state.event.sourceFileId}/${state.event.revision}/batch-failure.json`;
}

export function createPersistValidationFailNode(deps: PersistValidationFailDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const artifactKey = reasonKey(state);
    const dataFingerprints = (state.pages ?? [])
      .map((page) =>
        buildNormalizedDataFingerprint(
          (page.normalized ?? {}) as Record<string, unknown>,
        ),
      )
      .filter((value): value is string => Boolean(value));
    const batchDataFingerprint = buildBatchDataFingerprint(dataFingerprints);
    const pages = (state.pages ?? []).map((page) => ({
      pageNumber: page.pageNumber,
      classification: page.classification,
      extraction: page.extraction,
      extracted: page.extracted,
      normalized: page.normalized,
      dedupe: {
        dataFingerprint: buildNormalizedDataFingerprint(
          (page.normalized ?? {}) as Record<string, unknown>,
        ) ?? null,
      },
      masterlistLookup: page.masterlistLookup,
      validation: page.validation,
      decision: page.decision,
    }));

    const payload = {
      status: "error",
      event: state.event,
      source: state.source,
      pages,
      batchSummary: state.batchSummary,
      masterlistLookup: state.masterlistLookup,
      normalized: state.normalized,
      dedupe: {
        originalFileName: state.event.originalFileName,
        sourceHash: state.source?.hash ?? null,
        dataFingerprint: batchDataFingerprint ?? null,
        dataFingerprints,
      },
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["missing_validation"],
        checks: []
      },
      decision: state.decision,
      createdAt: new Date().toISOString()
    };

    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: artifactKey,
        Body: JSON.stringify(payload),
        ContentType: "application/json"
      })
    );

    await deps.db.insert(documentResults).values({
      jobId: state.jobId,
      eventId: state.event.eventId,
      uploadId: state.event.uploadId,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      documentKind: "upload",
      pageNumber: null,
      outcome: "Error",
      status: "error",
      finalKey: state.artifactKeys?.finalResultJson ?? artifactKey,
      originalFileName: state.event.originalFileName,
      sourceHash: state.source?.hash ?? null,
      dataFingerprint: batchDataFingerprint ?? null,
      reasonCodes: state.decision?.reasonCodes ?? ["validation_failed"],
      payload,
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["missing_validation"],
        checks: []
      },
      artifactKey
    });

    return {
      decision: {
        terminalStatus: "Error",
        route: "error",
        reasonCodes: state.decision?.reasonCodes ?? ["validation_failed"],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision
      },
      artifactKeys: {
        ...state.artifactKeys,
        finalResultJson: artifactKey
      }
    };
  };
}
