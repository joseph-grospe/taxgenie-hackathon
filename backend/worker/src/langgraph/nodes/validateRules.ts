import type { ValidationResult, WorkflowState } from "../types";

export async function validateRulesNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const reasons: string[] = [];

  if (!state.normalized) {
    reasons.push("missing_normalized_payload");
  }

  const validation: ValidationResult = {
    status: reasons.length === 0 ? "valid" : "invalid",
    reasons
  };

  return { validation };
}
