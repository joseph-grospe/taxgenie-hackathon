import type { WorkflowState } from "../types";

export async function normalizeFieldsNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  // Provider integration should call Azure OpenAI here.
  return {
    normalized: {
      ...state.extracted,
      normalizedAt: new Date().toISOString(),
      atcCode: "WC160"
    }
  };
}
