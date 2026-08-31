import { and, eq, isNull, sql } from "drizzle-orm";
import {
  buildOptionalCustomerStorageKey,
  buildOptionalEntityStorageKey,
  buildUnsignedCertificateFileName,
  buildUnsignedCertificateKey,
  formatCertificatePeriodKey,
  normalizeIssuerShortname,
  type Logger,
  type ObjectStorage,
} from "@taxgenie/shared";
import { createHash } from "node:crypto";
import type { DbClient } from "../../db/client";
import { applyAutomaticReconciliationMatch } from "../../db/reconciliationAutoMatch";
import {
  certificateTaxRows,
  documentExtractionAttempts,
  documentResults,
  extractedCertificates,
  resultArtifacts,
} from "../../db/schema";
import { reserveCertificateProcessedNumber } from "../../persistence/processedNumber";
import {
  buildCertificateMetadataResult,
  deriveCertificateBillingMonthMMYY,
  persistIntakeFileCertificateMetadata,
  type CertificateMetadataFields,
} from "../utils/certificateMetadata";
import { normalizeAtcCode } from "../utils/atc";
import type {
  PersistedDocumentExtractionPayload,
  WorkflowCertificateState,
  WorkflowState,
} from "../types";

interface PersistResultsDeps {
  db: DbClient;
  storage: ObjectStorage;
  bucket: string;
  logger: Logger;
  reconcileCertificate?: typeof applyAutomaticReconciliationMatch;
}

function checksum(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function toOptionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toSafeSchemaIssues(
  value: unknown,
): Array<{ path: string; code: string }> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const issues = value.slice(0, 5).flatMap((issue) => {
    if (typeof issue !== "object" || issue === null || Array.isArray(issue)) {
      return [];
    }
    const path = (issue as Record<string, unknown>).path;
    const code = (issue as Record<string, unknown>).code;
    return typeof path === "string" &&
      path.length <= 200 &&
      /^(?:root|[a-zA-Z0-9_*.[\]-]+)$/u.test(path) &&
      typeof code === "string" &&
      /^[a-z0-9_]+$/u.test(code)
      ? [{ path, code }]
      : [];
  });
  return issues.length > 0 ? issues : null;
}

function buildPayload(
  state: WorkflowState,
): PersistedDocumentExtractionPayload | null {
  if (
    !state.extractionResult ||
    !state.extractionMetadata ||
    !state.source?.hash
  ) {
    return null;
  }
  return {
    schemaVersion: 3,
    extraction: state.extractionResult,
    processing: {
      metadata: state.extractionMetadata,
      pageValidationIssues: state.extractionPageIssues ?? [],
      ignoredBlankPageNumbers: state.ignoredBlankPageNumbers ?? [],
      pageWarnings: state.pageWarnings ?? [],
      tinVerifications: (state.certificates ?? []).flatMap((certificate) =>
        (certificate.tinVerifications ?? []).map((verification) => ({
          certificateOrdinal: certificate.ordinal,
          ...verification,
        })),
      ),
      identityFieldDecisions: (state.certificates ?? []).flatMap(
        (certificate) =>
          (certificate.identityFieldDecisions ?? []).map((decision) => ({
            certificateOrdinal: certificate.ordinal,
            ...decision,
          })),
      ),
      fallbacks: (state.certificates ?? []).map((certificate) => ({
        certificateOrdinal: certificate.ordinal,
        signature: certificate.signatureFallback,
      })),
      certificateSelection: state.certificateSelection,
      sourceHash: state.source.hash,
      extractedAt: new Date().toISOString(),
    },
  };
}

function toFiniteDecimal(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function derivePrimaryAtcTotals(certificate: WorkflowCertificateState): {
  taxBase: string | null;
  taxWithheld: string | null;
} {
  const value = certificate.effective;
  const primaryAtcCode = normalizeAtcCode(value.primaryAtcCode);
  if (!primaryAtcCode) {
    return { taxBase: null, taxWithheld: null };
  }

  const primaryRows = value.taxRows.filter(
    (row) => normalizeAtcCode(row.atcCode) === primaryAtcCode,
  );
  const sumCompleteField = (
    field: "taxBase" | "taxWithheld",
  ): string | null => {
    if (primaryRows.length === 0) {
      return null;
    }
    const amounts = primaryRows.map((row) => toFiniteDecimal(row[field]));
    if (!amounts.every((amount): amount is number => amount !== null)) {
      return null;
    }
    return amounts.reduce((total, amount) => total + amount, 0).toFixed(2);
  };

  return {
    taxBase: sumCompleteField("taxBase"),
    taxWithheld: sumCompleteField("taxWithheld"),
  };
}

function projection(certificate: WorkflowCertificateState) {
  const value = certificate.effective;
  const totals = derivePrimaryAtcTotals(certificate);
  return {
    ordinal: certificate.ordinal,
    certificateKey: value.certificateKey,
    pageNumbers: value.pageNumbers,
    status: certificate.status,
    periodStart: value.period.start,
    periodEnd: value.period.end,
    monthOfQuarter: value.period.monthOfQuarter,
    payeeName: value.payee.name,
    payeeTin: value.payee.tin,
    payeeAddress: value.payee.address,
    payeeZip: value.payee.zip,
    payeeShortName: certificate.payeeShortName,
    payorName: value.payor.name,
    payorTin: value.payor.tin,
    payorAddress: value.payor.address,
    payorZip: value.payor.zip,
    payorShortName: certificate.payorShortName,
    primaryAtcCode: value.primaryAtcCode,
    totalTaxBase: totals.taxBase,
    totalTaxWithheld: totals.taxWithheld,
    signerPrintedName: value.signer.printedName,
    signerTitle: value.signer.title,
    signerTin: value.signer.tin,
    signerCompanyName: value.signer.companyName,
    signaturePresent: value.signer.signature.present,
    signatureConfidence: String(value.signer.signature.confidence),
    signaturePageNumber: value.signer.signature.pageNumber,
    signatureSource: value.signer.signature.source,
    validationStatus: certificate.validation?.status ?? "invalid",
    reasonCodes: certificate.reasonCodes,
    validationSummary: certificate.validation
      ? (certificate.validation as unknown as Record<string, unknown>)
      : null,
    masterlistResolution: certificate.masterlistLookup
      ? (certificate.masterlistLookup as unknown as Record<string, unknown>)
      : null,
    confidenceSummary: value.confidence,
    fingerprint:
      certificate.fingerprint ??
      createHash("sha256")
        .update(`${value.certificateKey}:${certificate.ordinal}`)
        .digest("hex"),
  };
}

function normalizedFileNameInput(certificate: WorkflowCertificateState) {
  const value = certificate.effective;
  return {
    periodEnd: value.period.end,
    payorName: value.payor.name,
    payorTin: value.payor.tin,
    companyName: value.signer.companyName,
  };
}

export function buildIntakeFileCertificateMetadata(
  state: WorkflowState,
): CertificateMetadataFields | null {
  let firstCertificate: WorkflowCertificateState | undefined;
  for (const certificate of state.certificates ?? []) {
    if (!firstCertificate || certificate.ordinal < firstCertificate.ordinal) {
      firstCertificate = certificate;
    }
  }

  if (!firstCertificate) {
    return null;
  }

  const value = firstCertificate.effective;
  return buildCertificateMetadataResult({
    originalFileName: state.event.originalFileName,
    isCertificate: true,
    normalized: {
      periodEnd: value.period.end,
      monthOfQuarter: value.period.monthOfQuarter,
    },
    resultColumns: {
      periodEnd: value.period.end,
      payeeName: value.payee.name,
      payeeTin: value.payee.tin,
      payeeShortName: firstCertificate.payeeShortName ?? null,
      payorName: value.payor.name,
      payorTin: value.payor.tin,
      payorShortName: firstCertificate.payorShortName ?? null,
    },
    uploadedAt: state.event.uploadedAt,
  }).fields;
}

export function createPersistResultsNode(deps: PersistResultsDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const status = state.documentStatus ?? "error";
    const payload = buildPayload(state);
    const intakeFileCertificateMetadata =
      buildIntakeFileCertificateMetadata(state);
    const persisted = await deps.db.transaction(async (tx) => {
      const finishedAt = new Date();
      const metadata = state.extractionMetadata;
      const failureTelemetry = state.extractionFailureTelemetry;
      await tx
        .update(documentExtractionAttempts)
        .set({
          status: state.extractionResult && metadata ? "succeeded" : "failed",
          reasonCodes: state.reasonCodes ?? [],
          schemaIssues:
            state.extractionResult && metadata
              ? null
              : toSafeSchemaIssues(failureTelemetry?.schemaIssues),
          requestedModel: metadata?.requestedModel,
          responseModel:
            metadata?.responseModel ??
            toOptionalString(failureTelemetry?.responseModel),
          thinkingLevel: metadata?.thinkingLevel,
          mediaResolution: metadata?.mediaResolution,
          providerAttemptCount:
            metadata?.attemptCount ??
            toOptionalNonNegativeInteger(failureTelemetry?.attemptCount),
          latencyMs:
            metadata?.latencyMs ??
            toOptionalNonNegativeInteger(failureTelemetry?.latencyMs),
          promptTokenCount:
            metadata?.usage.promptTokenCount ??
            toOptionalNonNegativeInteger(failureTelemetry?.promptTokenCount),
          outputTokenCount:
            metadata?.usage.outputTokenCount ??
            toOptionalNonNegativeInteger(failureTelemetry?.outputTokenCount),
          thoughtTokenCount:
            metadata?.usage.thoughtTokenCount ??
            toOptionalNonNegativeInteger(failureTelemetry?.thoughtTokenCount),
          totalTokenCount:
            metadata?.usage.totalTokenCount ??
            toOptionalNonNegativeInteger(failureTelemetry?.totalTokenCount),
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(documentExtractionAttempts.id, state.extractionAttemptId));

      const currentResult = {
        currentExtractionAttemptId: state.extractionAttemptId,
        jobId: state.jobId,
        eventId: state.event.eventId,
        batchId: state.event.batchId,
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        status,
        documentType:
          state.extractionResult?.classification.documentType ?? "UNKNOWN",
        pageCount: state.pageCount ?? 0,
        certificateCount: state.certificates?.length ?? 0,
        sourceHash: state.source?.hash,
        reasonCodes: state.reasonCodes ?? [],
        payload: payload as unknown as Record<string, unknown> | null,
        updatedAt: finishedAt,
      };
      const persistedDocuments = await tx
        .insert(documentResults)
        .values({
          uploadId: state.event.uploadId,
          ...currentResult,
        })
        .onConflictDoUpdate({
          target: documentResults.uploadId,
          set: currentResult,
          setWhere: and(
            eq(documentResults.status, "error"),
            isNull(documentResults.payload),
            eq(documentResults.certificateCount, 0),
            sql`${state.extractionAttemptId} = (
              select ${documentExtractionAttempts.id}
              from ${documentExtractionAttempts}
              where ${documentExtractionAttempts.uploadId} = ${state.event.uploadId}
              order by ${documentExtractionAttempts.retryNumber} desc,
                ${documentExtractionAttempts.workerAttemptNumber} desc,
                ${documentExtractionAttempts.id} desc
              limit 1
            )`,
          ),
        })
        .returning({ id: documentResults.id });
      const documentResultId = persistedDocuments[0]?.id;
      if (!documentResultId) {
        throw new Error(
          "Document result already has a valid or newer terminal outcome.",
        );
      }

      if (state.source?.hash) {
        await tx
          .insert(resultArtifacts)
          .values({
            documentResultId,
            certificateId: null,
            role: "source_pdf",
            bucket: state.source.bucket,
            key: state.source.key,
            contentType: state.source.contentType ?? "application/pdf",
            sha256: state.source.hash,
          })
          .onConflictDoNothing({
            target: [resultArtifacts.bucket, resultArtifacts.key],
          });
      }

      const certificateArtifacts: Array<{
        ordinal: number;
        key: string;
      }> = [];
      const acceptedCertificates: Array<{
        id: number;
        certificate: WorkflowCertificateState;
      }> = [];
      for (const certificate of state.certificates ?? []) {
        const insertedCertificates = await tx
          .insert(extractedCertificates)
          .values({
            documentResultId,
            ...projection(certificate),
          })
          .returning({ id: extractedCertificates.id });
        const certificateId = insertedCertificates[0]?.id;
        if (!certificateId) {
          throw new Error(
            `Unable to persist certificate ${certificate.ordinal}.`,
          );
        }

        if (certificate.effective.taxRows.length > 0) {
          await tx.insert(certificateTaxRows).values(
            certificate.effective.taxRows.map((row) => ({
              certificateId,
              lineNumber: row.lineNumber,
              pageNumber: row.pageNumber,
              atcCode: row.atcCode,
              description: row.description,
              firstMonthAmount: row.monthlyAmounts.first,
              secondMonthAmount: row.monthlyAmounts.second,
              thirdMonthAmount: row.monthlyAmounts.third,
              taxBase: row.taxBase,
              taxRate: row.taxRate,
              taxWithheld: row.taxWithheld,
              evidence: row.evidence,
            })),
          );
        }

        if (
          (certificate.status === "accepted" ||
            certificate.status === "manual_review") &&
          certificate.certificatePdfBase64
        ) {
          const processedNumber = await reserveCertificateProcessedNumber(tx, {
            payorShortName: certificate.payorShortName,
            uploadedAt: state.event.uploadedAt,
          });
          const key = buildUnsignedCertificateKey({
            entityKey: buildOptionalEntityStorageKey(
              state.event.selectedEntity,
            ),
            customerKey: buildOptionalCustomerStorageKey({
              shortName: certificate.payorShortName,
            }),
            period: formatCertificatePeriodKey(
              certificate.effective.period.end,
            ),
            batchId: state.event.batchId,
            certificateId,
            fileName: buildUnsignedCertificateFileName(
              state.event.sourceFileId,
              normalizedFileNameInput(certificate),
              processedNumber,
            ),
          });
          const body = Buffer.from(certificate.certificatePdfBase64, "base64");
          await deps.storage.write({
            bucket: deps.bucket,
            key,
            body,
            contentType: "application/pdf",
          });
          await tx.insert(resultArtifacts).values({
            documentResultId,
            certificateId,
            role: "certificate_pdf",
            bucket: deps.bucket,
            key,
            contentType: "application/pdf",
            sha256: checksum(body),
          });
          certificateArtifacts.push({ ordinal: certificate.ordinal, key });
        }
        if (certificate.status === "accepted") {
          acceptedCertificates.push({ id: certificateId, certificate });
        }
      }

      if (intakeFileCertificateMetadata) {
        await persistIntakeFileCertificateMetadata(
          tx,
          state.event.uploadId,
          intakeFileCertificateMetadata,
        );
      }

      return { documentResultId, certificateArtifacts, acceptedCertificates };
    });

    deps.logger.info("agentic_document_result_persisted", {
      jobId: state.jobId,
      sourceFileId: state.event.sourceFileId,
      documentResultId: persisted.documentResultId,
      status,
      certificateCount: state.certificates?.length ?? 0,
    });

    for (const accepted of persisted.acceptedCertificates) {
      const value = accepted.certificate.effective;
      const totals = accepted.certificate.reconciliationTotals ?? value.totals;
      if (totals.taxBase === null || totals.taxWithheld === null) {
        deps.logger.info("certificate_auto_reconciliation_skipped", {
          certificateId: accepted.id,
          documentResultId: persisted.documentResultId,
          reasonCode: "no_complete_we_tax_rows",
        });
        continue;
      }
      try {
        await (deps.reconcileCertificate ?? applyAutomaticReconciliationMatch)(
          deps.db,
          {
            batchId: state.event.batchId,
            certificateId: accepted.id,
            uploadId: state.event.uploadId,
            sourceFileId: state.event.sourceFileId,
            originalFileName: state.event.originalFileName,
            normalized: {
              taxBase: totals.taxBase,
              taxWithheld: totals.taxWithheld,
            },
            metadata: {
              documentType: "BIR2307",
              normalizedIssuerShortname: accepted.certificate.payorShortName
                ? normalizeIssuerShortname(accepted.certificate.payorShortName)
                : null,
              billingMonthMMYY: deriveCertificateBillingMonthMMYY({
                periodEnd: value.period.end,
                monthOfQuarter: value.period.monthOfQuarter,
              }),
            },
          },
        );
      } catch (error) {
        deps.logger.warn("certificate_auto_reconciliation_failed", {
          certificateId: accepted.id,
          documentResultId: persisted.documentResultId,
          errorCode: "auto_reconciliation_failed",
          errorName:
            error instanceof Error ? error.name : "UnknownReconciliationError",
        });
      }
    }

    return {
      documentResultId: persisted.documentResultId,
      certificates: (state.certificates ?? []).map((certificate) => ({
        ...certificate,
        certificatePdfBase64: undefined,
        artifactKey: persisted.certificateArtifacts.find(
          (artifact) => artifact.ordinal === certificate.ordinal,
        )?.key,
      })),
      decision: {
        terminalStatus:
          status === "error"
            ? "Error"
            : status === "duplicate"
              ? "Duplicate"
              : "Done",
        route:
          status === "error"
            ? "error"
            : status === "duplicate"
              ? "duplicate"
              : "continue",
        documentStatus: status,
        reasonCodes: state.reasonCodes ?? [],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
      },
    };
  };
}
