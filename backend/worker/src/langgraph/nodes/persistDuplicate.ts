import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DbClient } from "../../db/client";
import { documentResults } from "../../db/schema";
import type { WorkflowState } from "../types";
import { buildNormalizedDataFingerprint } from "../utils/dedupe";
import { buildDocumentResultColumns } from "../utils/documentResultColumns";

interface PersistDuplicateDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
}

function duplicateMarkerKey(state: WorkflowState): string {
  return `duplicates/${state.event.sourceFileId}/${state.event.revision}/batch-duplicate.json`;
}

export function createPersistDuplicateNode(deps: PersistDuplicateDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const artifactKey = duplicateMarkerKey(state);
    const normalized = (state.normalized ?? {}) as Record<string, unknown>;
    const dataFingerprint = buildNormalizedDataFingerprint(
      normalized,
    );
    const payload = {
      status: "duplicate",
      event: state.event,
      source: state.source,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      pages: (state.pages ?? []).map((page) => ({
        pageNumber: page.pageNumber,
        classification: page.classification,
        extraction: page.extraction,
        extracted: page.extracted,
        normalized: page.normalized,
        masterlistLookup: page.masterlistLookup,
        validation: page.validation,
        decision: page.decision,
      })),
      batchSummary: state.batchSummary,
      masterlistLookup: state.masterlistLookup,
      normalized: state.normalized,
      dedupe: {
        originalFileName: state.event.originalFileName,
        sourceHash: state.source?.hash ?? null,
        dataFingerprint: dataFingerprint ?? null,
      },
      validation: state.validation,
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

    const resultColumns = await buildDocumentResultColumns(
      deps.db,
      normalized,
    );

    await deps.db.insert(documentResults).values({
      jobId: state.jobId,
      eventId: state.event.eventId,
      batchId: state.event.batchId,
      uploadId: state.event.uploadId,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      outcome: "Duplicate",
      status: "duplicate",
      finalKey: state.artifactKeys?.renamedPdf,
      originalFileName: state.event.originalFileName,
      sourceHash: state.source?.hash ?? null,
      dataFingerprint: dataFingerprint ?? null,
      ...resultColumns,
      reasonCodes: state.decision?.reasonCodes ?? [
        "duplicate_source_file_revision",
      ],
      payload,
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["duplicate"],
        checks: [],
      },
      artifactKey,
    });

    return {
      artifactKeys: {
        ...state.artifactKeys,
        rawResultJson: artifactKey,
      },
      decision: {
        terminalStatus: "Duplicate",
        route: "duplicate",
        reasonCodes: state.decision?.reasonCodes ?? [
          "duplicate_source_file_revision",
        ],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
      },
    };
  };
}
