import type { Logger } from "@taxtrack/shared";
import type { NormalizedFields, WorkflowPageState, WorkflowState } from "../types";
import type { NormalizedResult } from "../services/azureNormalizerClient";

interface NormalizeDeps {
  normalizer: (input: {
    extraction: NonNullable<WorkflowState["extraction"]>;
    sourceFileId: string;
    revision: string;
  }) => Promise<NormalizedResult>;
  logger: Logger;
}

function clonePage(page: WorkflowPageState): WorkflowPageState {
  return {
    ...page,
    extracted: page.extracted ? { ...page.extracted } : undefined,
    normalized: page.normalized ? { ...page.normalized } : undefined,
    validation: page.validation ? { ...page.validation, reasons: [...page.validation.reasons], checks: [...page.validation.checks] } : undefined,
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
    const certificatePages = (state.pages ?? []).filter(
      (page) => page.classification === "certificate",
    );

    if (certificatePages.length === 0) {
      return {
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "missing_extraction_payload"],
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
              message: "No certificate page extraction payload available for normalization",
            },
          ],
        },
      };
    }

    const pageMap = new Map<number, WorkflowPageState>(
      (state.pages ?? []).map((page) => [page.pageNumber, clonePage(page)]),
    );

    for (const page of certificatePages) {
      if (!page.extraction) {
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
                message: `Certificate page ${page.pageNumber} has no extraction payload`,
              },
            ],
          },
        };
      }

      const normalized = await deps.normalizer({
        extraction: page.extraction,
        sourceFileId: state.event.sourceFileId,
        revision: `${state.event.revision}-page-${page.pageNumber}`,
      });

      const fields = normalized.fields as NormalizedFields;
      const existing = pageMap.get(page.pageNumber) ?? page;
      pageMap.set(page.pageNumber, {
        ...existing,
        normalized: fields,
      });
    }

    deps.logger.info("Normalization completed for certificate pages", {
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      certificatePages: certificatePages.map((page) => page.pageNumber),
    });

    const pages = Array.from(pageMap.values()).sort((left, right) => left.pageNumber - right.pageNumber);
    const primaryPage = pages.find(
      (page) => page.classification === "certificate" && page.normalized,
    );

    return {
      pages,
      normalized: primaryPage?.normalized,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "validate",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        finishedAt: new Date().toISOString(),
      },
      artifactKeys: {
        ...state.artifactKeys,
        finalResultJson:
          state.artifactKeys?.finalResultJson ??
          `results/${state.event.sourceFileId}/${state.event.revision}/final-result.json`,
      },
    };
  };
}
