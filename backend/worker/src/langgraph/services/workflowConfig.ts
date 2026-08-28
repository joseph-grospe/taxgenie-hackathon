import type { WorkerEnv } from "@taxgenie/shared";

export interface WorkflowEngineConfig {
  varianceThresholdPhp: number;
  sourceBucket: string;
  signatureVisualDetectorEnabled: boolean;
  signatureVisualMinConfidence: number;
  signatureVisualDpi: number;
  signatureVisualTimeoutMs: number;
  pdfTextLayerFallbackEnabled: boolean;
  payorSignerVerificationEnabled: boolean;
  identityConfidenceFlowEnabled: boolean;
}

export function buildWorkflowConfig(env: WorkerEnv): WorkflowEngineConfig {
  return {
    varianceThresholdPhp: env.VARIANCE_THRESHOLD_PHP,
    sourceBucket: env.S3_BUCKET_NAME,
    signatureVisualDetectorEnabled: env.SIGNATURE_VISUAL_DETECTOR_ENABLED,
    signatureVisualMinConfidence: env.SIGNATURE_VISUAL_MIN_CONFIDENCE,
    signatureVisualDpi: env.SIGNATURE_VISUAL_DPI,
    signatureVisualTimeoutMs: env.SIGNATURE_VISUAL_TIMEOUT_MS,
    pdfTextLayerFallbackEnabled: env.PDF_TEXT_LAYER_FALLBACK_ENABLED,
    payorSignerVerificationEnabled: env.PAYOR_SIGNER_VERIFICATION_ENABLED,
    identityConfidenceFlowEnabled: env.IDENTITY_CONFIDENCE_FLOW_ENABLED,
  };
}
