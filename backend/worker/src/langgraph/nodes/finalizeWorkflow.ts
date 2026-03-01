import type { WorkflowState } from "../types";

export function createFinalizeWorkflowNode() {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const finishedAt = new Date().toISOString();
    const terminalStatus = state.decision?.terminalStatus ?? "Error";
    const route = state.decision?.route ?? "error";

    return {
      workflowFinishedAt: finishedAt,
      decision: {
        terminalStatus,
        route,
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        finishedAt
      },
      artifactKeys: {
        source: state.artifactKeys?.source,
        rawResultJson: state.artifactKeys?.rawResultJson,
        finalResultJson: state.artifactKeys?.finalResultJson,
        renamedPdf: state.artifactKeys?.renamedPdf,
        reconciliationArtifact: state.artifactKeys?.reconciliationArtifact
      }
    };
  };
}
