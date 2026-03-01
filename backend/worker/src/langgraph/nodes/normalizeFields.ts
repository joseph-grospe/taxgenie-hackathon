import type { Logger } from "@taxtrack/shared";
import type { NormalizedFields, WorkflowState } from "../types";
import type { NormalizedResult } from "../services/azureNormalizerClient";

interface NormalizeDeps {
  normalizer: (input: {
    extraction: WorkflowState["extraction"];
    sourceFileId: string;
    revision: string;
  }) => Promise<NormalizedResult>;
  logger: Logger;
}

export function createNormalizeFieldsNode(deps: NormalizeDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    if (!state.extraction || !state.source) {
      return {
        decision: {
          terminalStatus: "Error",
          route: "error",
          reasonCodes: [...(state.decision?.reasonCodes ?? []), "missing_extraction_payload"],
          phase: "normalize",
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision
        },
        validation: {
          status: "invalid",
          reasons: ["missing_extraction_payload"],
          checks: [
            {
              code: "MISSING_EXTRACTION_PAYLOAD",
              passed: false,
              message: "No extraction payload available for normalization"
            }
          ]
        }
      };
    }

    const normalized = await deps.normalizer({
      extraction: state.extraction,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision
    });

    const fields = normalized.fields as NormalizedFields;
    deps.logger.info("Normalization completed", {
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      hasAtc: Boolean(fields.atcCode)
    });

    return {
      normalized: fields,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "validate",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        finishedAt: new Date().toISOString()
      },
      artifactKeys: {
        ...state.artifactKeys,
        finalResultJson:
          state.artifactKeys?.finalResultJson ??
          `results/${state.event.sourceFileId}/${state.event.revision}/final-result.json`
      }
    };
  };
}
