import type { WorkflowState } from "../types";

export function createFinalizeWorkflowNode() {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const finishedAt = new Date().toISOString();
    return {
      workflowFinishedAt: finishedAt,
      decision: {
        terminalStatus: state.decision?.terminalStatus ?? "Error",
        route: state.decision?.route ?? "error",
        documentStatus: state.documentStatus ?? "error",
        reasonCodes: state.reasonCodes ?? state.decision?.reasonCodes ?? [],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        finishedAt,
      },
    };
  };
}
