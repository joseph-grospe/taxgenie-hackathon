import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { documentResults, intakeFiles } from "../../db/schema";
import type {
  ValidationCheck,
  ValidationResult,
  WorkflowState,
} from "../types";
import { buildNormalizedDataFingerprint } from "../utils/dedupe";

interface DedupeDeps {
  db: DbClient;
}

type DuplicateSignal = {
  reasonCode: string;
  checkCode: string;
  message: string;
};

const isBir2307DocumentType = sql`
  regexp_replace(
    upper(coalesce(${intakeFiles.certificateDocumentType}, '')),
    '[^A-Z0-9]',
    '',
    'g'
  ) = 'BIR2307'
`;

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
    const currentDataFingerprint = buildNormalizedDataFingerprint(
      (state.normalized ?? {}) as Record<string, unknown>,
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
          id: documentResults.id,
        })
        .from(documentResults)
        .innerJoin(intakeFiles, eq(documentResults.uploadId, intakeFiles.id))
        .where(
          and(
            ne(documentResults.uploadId, state.event.uploadId),
            eq(documentResults.originalFileName, state.event.originalFileName),
            eq(documentResults.outcome, "Done"),
            eq(documentResults.status, "success"),
            isBir2307DocumentType,
          ),
        )
        .orderBy(asc(documentResults.createdAt), asc(documentResults.id))
        .limit(1),
      currentSourceHash
        ? deps.db
            .select({
              id: documentResults.id,
            })
            .from(documentResults)
            .innerJoin(
              intakeFiles,
              eq(documentResults.uploadId, intakeFiles.id),
            )
            .where(
              and(
                ne(documentResults.uploadId, state.event.uploadId),
                eq(documentResults.sourceHash, currentSourceHash),
                eq(documentResults.outcome, "Done"),
                eq(documentResults.status, "success"),
                isBir2307DocumentType,
              ),
            )
            .orderBy(asc(documentResults.createdAt), asc(documentResults.id))
            .limit(1)
        : Promise.resolve([]),
      currentDataFingerprint
        ? deps.db
            .select({
              originalFileName: documentResults.originalFileName,
            })
            .from(documentResults)
            .where(
              and(
                ne(documentResults.uploadId, state.event.uploadId),
                eq(documentResults.status, "success"),
                eq(documentResults.dataFingerprint, currentDataFingerprint),
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
      sameDataFingerprintResult,
    ] = duplicateQueryCandidates;

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

    if (sameDataFingerprintResult.length > 0) {
      const originalFileName = sameDataFingerprintResult[0]?.originalFileName;
      duplicateSignals.push({
        reasonCode: "duplicate_identical_data",
        checkCode: "DUPLICATE_IDENTICAL_DATA",
        message: originalFileName
          ? `Certificate data matches a previously uploaded certificate: ${originalFileName}.`
          : "Certificate data matches a previously uploaded certificate.",
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
        duplicatePageNumbers: state.batchSummary?.certificatePageNumbers ?? [],
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
