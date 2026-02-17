import type { WorkflowState } from "../types";

export async function extractDocumentNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  // Provider integration should call Mistral Document AI here.
  return {
    extracted: {
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      extractedAt: new Date().toISOString()
    }
  };
}
