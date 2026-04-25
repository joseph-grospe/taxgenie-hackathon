import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { documentResults, intakeFiles } from "../../db/schema";
import type {
  ValidationCheck,
  ValidationResult,
  WorkflowState,
} from "../types";
import {
  buildBatchDataFingerprint,
  collectCurrentCertificatePageFingerprints,
  collectStoredPageFingerprints,
  collectCurrentCertificateDataFingerprints,
  matchCurrentPagesToStoredDuplicates,
} from "../utils/dedupe";

interface DedupeDeps {
  db: DbClient;
}

type DuplicateSignal = {
  reasonCode: string;
  checkCode: string;
  message: string;
};

function toPayloadRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatIdenticalDataMessage(match: {
  currentPageNumber: number;
  existingPageNumber: number | null;
  existingFileName: string | null;
}): string {
  const currentPage = `current page ${match.currentPageNumber}`;
  const existingPage =
    typeof match.existingPageNumber === "number"
      ? `page ${match.existingPageNumber}`
      : "an existing certificate page";
  const fileNameSuffix = match.existingFileName
    ? ` in ${match.existingFileName}`
    : "";

  return `${currentPage} matches ${existingPage}${fileNameSuffix}`;
}

function buildDuplicateValidation(
  state: WorkflowState,
  signals: DuplicateSignal[],
): ValidationResult {
  const existingChecks = state.validation?.checks ?? [];
  const existingReasons = state.validation?.reasons ?? [];
  const checks: ValidationCheck[] = [
    ...existingChecks,
    ...signals.map((signal) => ({
      code: signal.checkCode,
      passed: false,
      message: signal.message,
    })),
  ];

  return {
    status: "invalid",
    reasons: [
      ...new Set([
        ...existingReasons,
        ...signals.map((signal) => signal.reasonCode),
      ]),
    ],
    checks,
    atcCode: state.validation?.atcCode,
    atcRate: state.validation?.atcRate,
    computedTaxBase: state.validation?.computedTaxBase,
    reportedTaxBase: state.validation?.reportedTaxBase,
    variance: state.validation?.variance,
    threshold: state.validation?.threshold,
  };
}

export function createDedupeCheckNode(deps: DedupeDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const currentPageFingerprints = collectCurrentCertificatePageFingerprints(
      state.pages ?? [],
    );
    const currentDataFingerprints = collectCurrentCertificateDataFingerprints(
      state.pages ?? [],
    );
    const currentBatchDataFingerprint = buildBatchDataFingerprint(
      currentDataFingerprints,
    );
    const currentSourceHash = state.source?.hash?.trim().toLowerCase();

    const duplicateQueryCandidates = await Promise.all([
      deps.db
        .select({
          outcome: documentResults.outcome,
        })
        .from(documentResults)
        .where(
          and(
            eq(documentResults.sourceFileId, state.event.sourceFileId),
            eq(documentResults.revision, state.event.revision),
            inArray(documentResults.outcome, ["Done", "Duplicate"]),
          ),
        )
        .limit(1),
      deps.db
        .select({
          id: intakeFiles.id,
        })
        .from(intakeFiles)
        .where(
          and(
            ne(intakeFiles.id, state.event.uploadId),
            eq(intakeFiles.originalFileName, state.event.originalFileName),
          ),
        )
        .limit(1),
      currentSourceHash
        ? deps.db
            .select({
              id: documentResults.id,
            })
            .from(documentResults)
            .where(
              and(
                ne(documentResults.uploadId, state.event.uploadId),
                eq(documentResults.sourceHash, currentSourceHash),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      currentDataFingerprints.length > 0
        ? Promise.all(
            currentDataFingerprints.map((fingerprint) =>
              deps.db
                .select({
                  pageNumber: documentResults.pageNumber,
                  originalFileName: documentResults.originalFileName,
                  dataFingerprint: documentResults.dataFingerprint,
                })
                .from(documentResults)
                .where(
                  and(
                    ne(documentResults.uploadId, state.event.uploadId),
                    eq(documentResults.documentKind, "certificate"),
                    eq(documentResults.dataFingerprint, fingerprint),
                  ),
                )
                .orderBy(
                  asc(documentResults.createdAt),
                  asc(documentResults.id),
                )
                .limit(1),
            ),
          )
        : Promise.resolve([]),
      currentBatchDataFingerprint
        ? deps.db
            .select({
              originalFileName: documentResults.originalFileName,
              payload: documentResults.payload,
            })
            .from(documentResults)
            .where(
              and(
                ne(documentResults.uploadId, state.event.uploadId),
                eq(documentResults.documentKind, "upload"),
                eq(
                  documentResults.dataFingerprint,
                  currentBatchDataFingerprint,
                ),
              ),
            )
            .orderBy(asc(documentResults.createdAt), asc(documentResults.id))
            .limit(1)
        : Promise.resolve([]),
    ]);

    const [
      sameSourceRevisionResult,
      previousFileNameUpload,
      sameSourceHashResult,
      sameDataFingerprintResultSets,
      sameBatchDataFingerprintResult,
    ] = duplicateQueryCandidates;
    const sameDataFingerprintResult = sameDataFingerprintResultSets.flat();

    const duplicateSignals: DuplicateSignal[] = [];

    if (sameSourceRevisionResult.length > 0) {
      duplicateSignals.push({
        reasonCode: "duplicate_source_file_revision",
        checkCode: "DUPLICATE_SOURCE_FILE_REVISION",
        message: "This source file revision has already been processed.",
      });
    }

    if (previousFileNameUpload.length > 0) {
      duplicateSignals.push({
        reasonCode: "duplicate_original_file_name",
        checkCode: "DUPLICATE_ORIGINAL_FILE_NAME",
        message: `File name matches a previous upload: ${state.event.originalFileName}`,
      });
    }

    if (sameSourceHashResult.length > 0) {
      duplicateSignals.push({
        reasonCode: "duplicate_uploaded_twice",
        checkCode: "DUPLICATE_UPLOADED_TWICE",
        message: "This exact file content was already uploaded before.",
      });
    }

    const duplicateMatches = matchCurrentPagesToStoredDuplicates(
      currentPageFingerprints,
      [
        ...sameDataFingerprintResult
          .filter(
            (
              result,
            ): result is {
              pageNumber: number | null;
              originalFileName: string | null;
              dataFingerprint: string;
            } => typeof result.dataFingerprint === "string",
          )
          .map((result) => ({
            pageNumber: result.pageNumber,
            dataFingerprint: result.dataFingerprint,
            existingFileName: result.originalFileName ?? null,
            matchedVia: "certificate" as const,
          })),
        ...sameBatchDataFingerprintResult.flatMap((result) =>
          collectStoredPageFingerprints(toPayloadRecord(result.payload)).map(
            (page) => ({
              pageNumber: page.pageNumber,
              dataFingerprint: page.dataFingerprint,
              existingFileName: result.originalFileName ?? null,
              matchedVia: "upload" as const,
            }),
          ),
        ),
      ],
    );

    if (duplicateMatches.length > 0) {
      duplicateSignals.push({
        reasonCode: "duplicate_identical_data",
        checkCode: "DUPLICATE_IDENTICAL_DATA",
        message: `Certificate data matches existing records: ${duplicateMatches
          .map(formatIdenticalDataMessage)
          .join(", ")}`,
      });
    } else if (
      sameDataFingerprintResult.length > 0 ||
      sameBatchDataFingerprintResult.length > 0
    ) {
      duplicateSignals.push({
        reasonCode: "duplicate_identical_data",
        checkCode: "DUPLICATE_IDENTICAL_DATA",
        message: "Certificate data matches a previously uploaded certificate.",
      });
    }

    if (duplicateSignals.length === 0) {
      return {
        decision: {
          terminalStatus: "Done",
          route: "continue",
          reasonCodes: state.decision?.reasonCodes ?? [],
          phase: "persist",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
        artifactKeys: state.artifactKeys,
      };
    }

    return {
      validation: buildDuplicateValidation(state, duplicateSignals),
      batchSummary: {
        totalPages: state.batchSummary?.totalPages ?? state.pages?.length ?? 0,
        certificatePageNumbers:
          state.batchSummary?.certificatePageNumbers ?? [],
        ignoredPageNumbers: state.batchSummary?.ignoredPageNumbers ?? [],
        validPageNumbers: [],
        failedPageNumbers: [],
        duplicatePageNumbers:
          duplicateMatches.length > 0
            ? duplicateMatches.map((match) => match.currentPageNumber)
            : (state.batchSummary?.duplicatePageNumbers ?? []),
        duplicateMatches,
      },
      decision: {
        terminalStatus: "Duplicate",
        route: "duplicate",
        reasonCodes: [
          ...new Set([
            ...(state.decision?.reasonCodes ?? []),
            ...duplicateSignals.map((signal) => signal.reasonCode),
          ]),
        ],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
      },
      artifactKeys: {
        ...state.artifactKeys,
        source:
          state.artifactKeys?.source ??
          `${state.event.sourceFileId}/${state.event.revision}`,
      },
    };
  };
}
