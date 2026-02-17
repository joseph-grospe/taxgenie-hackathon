import type { DriveFileEventV1 } from "@taxtrack/shared";

export interface ValidationResult {
  status: "valid" | "invalid";
  reasons: string[];
}

export interface WorkflowState {
  event: DriveFileEventV1;
  jobId: string;
  extracted?: Record<string, unknown>;
  normalized?: Record<string, unknown>;
  validation?: ValidationResult;
  artifactKey?: string;
}
