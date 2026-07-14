import {
  buildOptionalCustomerStorageKey,
  buildOptionalEntityStorageKey,
  buildProcessingArtifactKey,
} from "@taxtrack/shared";
import type { DbClient } from "../../db/client";
import type { ResultPersistenceService } from "../../persistence/resultPersistence";
import type { WorkflowState } from "../types";
import { buildCertificateMetadataResult } from "../utils/certificateMetadata";
import { buildNormalizedDataFingerprint } from "../utils/dedupe";
import { buildDocumentResultColumns } from "../utils/documentResultColumns";
import { buildPersistedPagePayload } from "../utils/resultPayload";

interface PersistValidationFailDeps {
  db: DbClient;
  bucket: string;
  persistence: ResultPersistenceService;
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
    const certificateMetadata = buildCertificateMetadataResult({
      originalFileName: state.event.originalFileName,
      isCertificate: (state.pages ?? []).some(
        (page) => page.classification === "certificate",
      ),
      normalized,
      resultColumns,
    });
    const artifactKey = reasonKey(state, resultColumns.payorShortName);
    const validation = state.validation ?? {
      status: "invalid" as const,
      reasons: ["missing_validation"],
      checks: [],
    };

    const persisted = await deps.persistence.persistPreparedResult(
      {
        event: state.event,
        outcome: "Error",
        build: ({ preparedAt }) => {
          const artifactKeys = {
            source: state.artifactKeys?.source,
            finalResultJson: artifactKey,
          };
          const payload = {
            payloadVersion: 2,
            status: "error",
            event: state.event,
            source: state.source,
            pages: (state.pages ?? []).map(buildPersistedPagePayload),
            batchSummary: state.batchSummary,
            masterlistLookup: state.masterlistLookup,
            normalized: state.normalized,
            dedupe: {
              originalFileName: state.event.originalFileName,
              sourceHash: state.source?.hash ?? null,
              dataFingerprint: dataFingerprint ?? null,
            },
            validation,
            decision: state.decision,
            artifactKeys,
            createdAt: preparedAt,
          };
          return {
            documentResult: {
              eventId: state.event.eventId,
              batchId: state.event.batchId,
              uploadId: state.event.uploadId,
              sourceFileId: state.event.sourceFileId,
              revision: state.event.revision,
              outcome: "Error",
              status: "error",
              finalKey: null,
              originalFileName: state.event.originalFileName,
              sourceHash: state.source?.hash ?? null,
              dataFingerprint: dataFingerprint ?? null,
              ...resultColumns,
              reasonCodes: state.decision?.reasonCodes ?? ["validation_failed"],
              payload,
              validation,
              artifactKey,
            },
            certificateMetadata: certificateMetadata.fields,
            artifacts: [
              {
                role: "final_json",
                bucket: deps.bucket,
                key: artifactKey,
                contentType: "application/json",
                body: { kind: "text", text: JSON.stringify(payload) },
              },
            ],
          };
        },
      },
      state.jobId,
    );

    return {
      artifactKey: persisted.artifactKey,
      artifactKeys: persisted.artifactKeys,
      decision: persisted.decision,
    };
  };
}
