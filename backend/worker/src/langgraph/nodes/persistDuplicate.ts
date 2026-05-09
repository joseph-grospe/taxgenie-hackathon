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

interface PersistDuplicateDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
}

function duplicateMarkerKey(
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
    fileName: "duplicate.json",
  });
}

export function createPersistDuplicateNode(deps: PersistDuplicateDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const normalized = (state.normalized ?? {}) as Record<string, unknown>;
    const dataFingerprint = buildNormalizedDataFingerprint(normalized);
    const resultColumns = await buildDocumentResultColumns(deps.db, normalized);
    const artifactKey = duplicateMarkerKey(state, resultColumns.payorShortName);
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
