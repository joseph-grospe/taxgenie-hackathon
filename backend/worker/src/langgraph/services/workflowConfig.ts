import type { WorkerEnv } from "@taxtrack/shared";

export interface WorkflowEngineConfig {
  varianceThresholdPhp: number;
  sourceBucket: string;
  zoneOcrFallbackEnabled: boolean;
  zoneOcrDpi: number;
  zoneOcrRenderTimeoutMs: number;
  zoneOcrMaxZonesPerPage: number;
  zoneOcrSinglePageRescueEnabled: boolean;
}

export function buildWorkflowConfig(env: WorkerEnv): WorkflowEngineConfig {
  return {
    varianceThresholdPhp: env.VARIANCE_THRESHOLD_PHP,
    sourceBucket: env.S3_BUCKET_NAME,
    zoneOcrFallbackEnabled: env.ZONE_OCR_FALLBACK_ENABLED,
    zoneOcrDpi: env.ZONE_OCR_DPI,
    zoneOcrRenderTimeoutMs: env.ZONE_OCR_RENDER_TIMEOUT_MS,
    zoneOcrMaxZonesPerPage: env.ZONE_OCR_MAX_ZONES_PER_PAGE,
    zoneOcrSinglePageRescueEnabled: env.ZONE_OCR_SINGLE_PAGE_RESCUE_ENABLED,
  };
}
