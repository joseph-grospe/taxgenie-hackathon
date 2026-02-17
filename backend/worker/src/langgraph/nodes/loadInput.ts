import type { WorkflowState } from "../types";

export async function loadInputNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  return {
    artifactKey: `results/${state.event.sourceFileId}/${state.event.revision}.json`
  };
}
