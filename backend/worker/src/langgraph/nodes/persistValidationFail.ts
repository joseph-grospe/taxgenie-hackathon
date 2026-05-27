import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  buildOptionalCustomerStorageKey,
  buildOptionalEntityStorageKey,
  buildProcessingArtifactKey,
} from "@taxtrack/shared";
import type { DbClient } from "../../db/client";
import { documentResults } from "../../db/schema";
import type { WorkflowState } from "../types";
import { buildNormalizedDataFingerprint } from "../utils/dedupe";
import { buildDocumentResultColumns } from "../utils/documentResultColumns";
import { buildPersistedPagePayload } from "../utils/resultPayload";

interface PersistValidationFailDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
}

function reasonKey(
  state: WorkflowState,
  customerShortName: string | null | undefined,
): string {
  return buildProcessingArtifactKey({
    entityKey: buildOptionalEntityStorageKey(state.event.selectedEntity),
    customerKey: buildOptionalCustomerStorageKey({
      shortName: customerShortName,
    }),
    batchId: state.event.batchId,
    uploadId: state.event.uploadId,
    revision: state.event.revision,
    fileName: "error.json",
  });
}

export function createPersistValidationFailNode(
  deps: PersistValidationFailDeps,
) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const normalized = (state.normalized ?? {}) as Record<string, unknown>;
    const dataFingerprint = buildNormalizedDataFingerprint(normalized);
    const resultColumns = await buildDocumentResultColumns(deps.db, normalized);
    const artifactKey = reasonKey(state, resultColumns.payorShortName);
    const pages = (state.pages ?? []).map(buildPersistedPagePayload);

    const payload = {
      payloadVersion: 2,
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
        dataFingerprint: dataFingerprint ?? null,
      },
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["missing_validation"],
        checks: [],
      },
      decision: state.decision,
      createdAt: new Date().toISOString(),
    };

    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: artifactKey,
        Body: JSON.stringify(payload),
        ContentType: "application/json",
      }),
    );

    await deps.db.insert(documentResults).values({
      jobId: state.jobId,
      eventId: state.event.eventId,
      batchId: state.event.batchId,
      uploadId: state.event.uploadId,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      outcome: "Error",
      status: "error",
      finalKey: state.artifactKeys?.finalResultJson ?? artifactKey,
      originalFileName: state.event.originalFileName,
      sourceHash: state.source?.hash ?? null,
      dataFingerprint: dataFingerprint ?? null,
      ...resultColumns,
      reasonCodes: state.decision?.reasonCodes ?? ["validation_failed"],
      payload,
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["missing_validation"],
        checks: [],
      },
      artifactKey,
    });

    return {
      decision: {
        terminalStatus: "Error",
        route: "error",
        reasonCodes: state.decision?.reasonCodes ?? ["validation_failed"],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
      },
      artifactKeys: {
        ...state.artifactKeys,
        finalResultJson: artifactKey,
      },
    };
  };
}
