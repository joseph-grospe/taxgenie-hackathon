import {
  buildOptionalCustomerStorageKey,
  buildOptionalEntityStorageKey,
  buildProcessingArtifactKey,
  buildUnsignedCertificateFileName,
  buildUnsignedCertificateKey,
  formatCertificatePeriodKey,
  type Logger,
} from "@taxtrack/shared";
import type { DbClient } from "../../db/client";
import type { ResultPersistenceService } from "../../persistence/resultPersistence";
import type { ArtifactKeys, WorkflowState } from "../types";
import { buildCertificateMetadataResult } from "../utils/certificateMetadata";
import { buildNormalizedDataFingerprint } from "../utils/dedupe";
import { buildDocumentResultColumns } from "../utils/documentResultColumns";
import {
  buildOcrEvidencePayload,
  buildPersistedPagePayload,
} from "../utils/resultPayload";

interface PersistValidatedDeps {
  db: DbClient;
  bucket: string;
  logger: Logger;
  persistence: ResultPersistenceService;
}

function getEntityKey(state: WorkflowState): string {
  return buildOptionalEntityStorageKey(state.event.selectedEntity);
}

function getCustomerKey(shortName: string | null | undefined): string {
  return buildOptionalCustomerStorageKey({ shortName });
}

function buildCertificateArtifactKeys(
  state: WorkflowState,
  customerKey: string,
  documentResultId: number,
  processedNumber: number,
  normalized: Record<string, unknown>,
): Required<
  Pick<ArtifactKeys, "rawResultJson" | "finalResultJson" | "renamedPdf">
> &
  Pick<ArtifactKeys, "source"> {
  const base = {
    entityKey: getEntityKey(state),
    customerKey,
    batchId: state.event.batchId,
    uploadId: state.event.uploadId,
    revision: state.event.revision,
  };
  return {
    source: state.artifactKeys?.source,
    rawResultJson: buildProcessingArtifactKey({
      ...base,
      fileName: "raw-extraction.json",
    }),
    finalResultJson: buildProcessingArtifactKey({
      ...base,
      fileName: "final-result.json",
    }),
    renamedPdf: buildUnsignedCertificateKey({
      entityKey: getEntityKey(state),
      customerKey,
      period: formatCertificatePeriodKey(
        normalized.periodEnd ?? normalized.periodCovered,
      ),
      batchId: state.event.batchId,
      documentResultId,
      fileName: buildUnsignedCertificateFileName(
        state.event.sourceFileId,
        normalized,
        processedNumber,
      ),
    }),
  };
}

export function createPersistValidatedNode(deps: PersistValidatedDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const certificatePages = (state.pages ?? []).filter(
      (page) => page.classification === "certificate",
    );
    if (certificatePages.length !== 1) {
      throw new Error(
        certificatePages.length === 0
          ? "Cannot persist validated results without certificate pages."
          : "Cannot persist more than one certificate result for a single upload.",
      );
    }

    const page = certificatePages[0];
    if (!page.sourceContentBase64 || !state.source) {
      throw new Error(
        "Cannot persist a validated certificate without its source page and source object metadata.",
      );
    }

    const normalized = (page.normalized ?? {}) as Record<string, unknown>;
    const dataFingerprint = buildNormalizedDataFingerprint(normalized);
    const dedupe = {
      originalFileName: state.event.originalFileName,
      sourceHash: state.source.hash ?? null,
      dataFingerprint: dataFingerprint ?? null,
    };
    const validation = (page.validation ?? {
      status: "invalid",
      reasons: ["missing_validation"],
      checks: [],
    }) as Record<string, unknown>;
    const resultColumns = await buildDocumentResultColumns(deps.db, normalized);
    const certificateMetadata = buildCertificateMetadataResult({
      originalFileName: state.event.originalFileName,
      isCertificate: true,
      normalized,
      resultColumns,
    });

    const persisted = await deps.persistence.persistPreparedResult(
      {
        event: state.event,
        outcome: "Done",
        payorShortName: resultColumns.payorShortName,
        uploadedAt: state.event.uploadedAt,
        build: ({ documentResultId, processedNumber, preparedAt }) => {
          const customerKey = getCustomerKey(resultColumns.payorShortName);
          const artifactKeys = buildCertificateArtifactKeys(
            state,
            customerKey,
            documentResultId,
            processedNumber,
            normalized,
          );
          const payload = {
            payloadVersion: 2,
            event: state.event,
            source: state.source,
            certificatePageNumber: page.pageNumber,
            batchSummary: state.batchSummary,
            pages: [buildPersistedPagePayload(page)],
            ocr: buildOcrEvidencePayload(page.extraction),
            masterlistLookup: page.masterlistLookup,
            normalized: page.normalized,
            validation: page.validation,
            decision: page.decision ?? state.decision,
            dedupe,
            artifactKeys,
          };
          const rawPayload = {
            stage: "raw",
            certificatePageNumber: page.pageNumber,
            source: state.source,
            extraction: page.extraction,
            generatedAt: preparedAt,
          };

          return {
            documentResult: {
              eventId: state.event.eventId,
              batchId: state.event.batchId,
              uploadId: state.event.uploadId,
              sourceFileId: state.event.sourceFileId,
              revision: state.event.revision,
              outcome: "Done",
              status: "success",
              finalKey: artifactKeys.renamedPdf,
              originalFileName: dedupe.originalFileName,
              sourceHash: dedupe.sourceHash,
              dataFingerprint: dedupe.dataFingerprint,
              ...resultColumns,
              reasonCodes: state.decision?.reasonCodes ?? [],
              payload,
              validation,
              artifactKey: artifactKeys.finalResultJson,
            },
            certificateMetadata: certificateMetadata.fields,
            reconciliationInput: {
              batchId: state.event.batchId,
              uploadId: state.event.uploadId,
              sourceFileId: state.event.sourceFileId,
              originalFileName: state.event.originalFileName,
              normalized,
              metadata: certificateMetadata.matchMetadata,
            },
            artifacts: [
              {
                role: "raw_json",
                bucket: deps.bucket,
                key: artifactKeys.rawResultJson,
                contentType: "application/json",
                body: { kind: "text", text: JSON.stringify(rawPayload) },
              },
              {
                role: "final_json",
                bucket: deps.bucket,
                key: artifactKeys.finalResultJson,
                contentType: "application/json",
                body: { kind: "text", text: JSON.stringify(payload) },
              },
              {
                role: "unsigned_pdf",
                bucket: deps.bucket,
                key: artifactKeys.renamedPdf,
                contentType: "application/pdf",
                body: {
                  kind: "source_page",
                  sourceBucket: state.source!.bucket,
                  sourceKey: state.source!.key,
                  sourcePageNumber: page.pageNumber,
                  sourceSha256: state.source!.hash,
                  inlineBody: Buffer.from(page.sourceContentBase64!, "base64"),
                },
              },
            ],
          };
        },
      },
      state.jobId,
    );

    deps.logger.info("Persisted validated certificate", {
      jobId: state.jobId,
      sourceFileId: state.event.sourceFileId,
      documentResultId: persisted.documentResultId,
      certificatePageNumber: page.pageNumber,
    });
    return {
      artifactKey: persisted.artifactKey,
      artifactKeys: persisted.artifactKeys,
      decision: persisted.decision,
    };
  };
}
