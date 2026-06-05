import {
  buildOptionalEntityStorageKey,
  buildProcessingArtifactKey,
  type Logger,
} from "@taxtrack/shared";
import type {
  NormalizedFields,
  WorkflowPageState,
  WorkflowState,
} from "../types";
import type { NormalizedResult } from "../services/azureNormalizerClient";

interface NormalizeDeps {
  normalizer: (input: {
    extraction: NonNullable<WorkflowState["extraction"]>;
    sourceFileId: string;
    revision: string;
    selectedEntity?: WorkflowState["event"]["selectedEntity"];
  }) => Promise<NormalizedResult>;
  logger: Logger;
}

const MULTIPLE_CERTIFICATE_REASON_CODE = "multiple_certificate_pages_detected";

function hasMultipleCertificateDetection(state: WorkflowState): boolean {
  return (
    (state.validation?.reasons.includes(MULTIPLE_CERTIFICATE_REASON_CODE) ??
      false) ||
    (state.decision?.reasonCodes.includes(MULTIPLE_CERTIFICATE_REASON_CODE) ??
      false)
  );
}

function clonePage(page: WorkflowPageState): WorkflowPageState {
  return {
    ...page,
    extracted: page.extracted ? { ...page.extracted } : undefined,
    normalized: page.normalized ? { ...page.normalized } : undefined,
    validation: page.validation
      ? {
          ...page.validation,
          reasons: [...page.validation.reasons],
          checks: [...page.validation.checks],
        }
      : undefined,
    masterlistLookup: page.masterlistLookup
      ? {
          ...page.masterlistLookup,
          matches: [...page.masterlistLookup.matches],
        }
      : undefined,
  };
}

export function createNormalizeFieldsNode(deps: NormalizeDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const certificatePage = (state.pages ?? []).find(
      (page) => page.classification === "certificate",
    );

    if (!certificatePage) {
      return {
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [
            ...(state.decision?.reasonCodes ?? []),
            "missing_extraction_payload",
          ],
          phase: "normalize",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
        validation: {
          status: "invalid",
          reasons: ["missing_extraction_payload"],
          checks: [
            {
              code: "MISSING_EXTRACTION_PAYLOAD",
              passed: false,
              message:
                "No certificate extraction payload available for normalization",
            },
          ],
        },
      };
    }

    const pageMap = new Map<number, WorkflowPageState>(
      (state.pages ?? []).map((page) => [page.pageNumber, clonePage(page)]),
    );

    if (!certificatePage.extraction) {
      return {
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: ["missing_extraction_payload"],
          phase: "normalize",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
        },
        validation: {
          status: "invalid",
          reasons: ["missing_extraction_payload"],
          checks: [
            {
              code: "MISSING_EXTRACTION_PAYLOAD",
              passed: false,
              message: "Certificate has no extraction payload",
            },
          ],
        },
      };
    }

    const normalized = await deps.normalizer({
      extraction: certificatePage.extraction,
      sourceFileId: state.event.sourceFileId,
      revision: `${state.event.revision}-page-${certificatePage.pageNumber}`,
      selectedEntity: state.event.selectedEntity,
    });

    const fields = normalized.fields as NormalizedFields;
    const existing = pageMap.get(certificatePage.pageNumber) ?? certificatePage;
    pageMap.set(certificatePage.pageNumber, {
      ...existing,
      normalized: fields,
    });

    deps.logger.info("Normalization completed for certificate", {
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      certificatePageNumber: certificatePage.pageNumber,
    });

    const pages = Array.from(pageMap.values()).sort(
      (left, right) => left.pageNumber - right.pageNumber,
    );
    const primaryPage = pageMap.get(certificatePage.pageNumber);
    const multipleCertificateDetected = hasMultipleCertificateDetection(state);
    const reasonCodes = multipleCertificateDetected
      ? [
          ...new Set([
            ...(state.decision?.reasonCodes ?? []),
            MULTIPLE_CERTIFICATE_REASON_CODE,
          ]),
        ]
      : (state.decision?.reasonCodes ?? []);

    return {
      pages,
      normalized: primaryPage?.normalized,
      validation: multipleCertificateDetected ? state.validation : undefined,
      batchSummary: multipleCertificateDetected
        ? {
            totalPages: state.batchSummary?.totalPages ?? pages.length,
            certificatePageNumbers:
              state.batchSummary?.certificatePageNumbers ?? [
                certificatePage.pageNumber,
              ],
            ignoredPageNumbers: state.batchSummary?.ignoredPageNumbers ?? [],
            validPageNumbers: [],
            failedPageNumbers:
              state.batchSummary?.certificatePageNumbers ?? [
                certificatePage.pageNumber,
              ],
            duplicatePageNumbers: state.batchSummary?.duplicatePageNumbers ?? [],
          }
        : state.batchSummary,
      decision: {
        terminalStatus: multipleCertificateDetected ? "Error" : "Done",
        route: multipleCertificateDetected ? "error" : "continue",
        reasonCodes,
        phase: multipleCertificateDetected ? "normalize" : "validate",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        finishedAt: new Date().toISOString(),
      },
      artifactKeys: {
        ...state.artifactKeys,
        finalResultJson:
          state.artifactKeys?.finalResultJson ??
          buildProcessingArtifactKey({
            entityKey: buildOptionalEntityStorageKey(state.event.selectedEntity),
            batchId: state.event.batchId,
            uploadId: state.event.uploadId,
            revision: state.event.revision,
            fileName: "final-result.json",
          }),
      },
    };
  };
}
