import type { WorkerEnv } from "@taxtrack/shared";

export interface WorkflowEngineConfig {
  atcRates: Record<string, number>;
  varianceThresholdPhp: number;
  sourceBucket: string;
  zoneOcrFallbackEnabled: boolean;
  zoneOcrDpi: number;
  zoneOcrRenderTimeoutMs: number;
  zoneOcrMaxZonesPerPage: number;
  zoneOcrSinglePageRescueEnabled: boolean;
}

function normalizeAtcCode(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "");
}

export function buildWorkflowConfig(env: WorkerEnv): WorkflowEngineConfig {
  const baseRates: Record<string, number> = {
    [normalizeAtcCode("WC160")]: env.ATC_RATE_WC160,
    [normalizeAtcCode("WC158")]: env.ATC_RATE_WC158,
    [normalizeAtcCode("WC051")]: env.ATC_RATE_WC051
  };

  const overrideRates = env.ATC_RATES_JSON ?? {};
  const mergedRates = { ...baseRates };

  for (const [rawKey, rawValue] of Object.entries(overrideRates)) {
    const normalizedCode = normalizeAtcCode(rawKey);
    if (!normalizedCode) {
      continue;
    }

    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) {
      continue;
    }

    mergedRates[normalizedCode] = numericValue;
  }

  return {
    atcRates: mergedRates,
    varianceThresholdPhp: env.VARIANCE_THRESHOLD_PHP,
    sourceBucket: env.S3_SOURCE_BUCKET ?? env.S3_BUCKET,
    zoneOcrFallbackEnabled: env.ZONE_OCR_FALLBACK_ENABLED,
    zoneOcrDpi: env.ZONE_OCR_DPI,
    zoneOcrRenderTimeoutMs: env.ZONE_OCR_RENDER_TIMEOUT_MS,
    zoneOcrMaxZonesPerPage: env.ZONE_OCR_MAX_ZONES_PER_PAGE,
    zoneOcrSinglePageRescueEnabled: env.ZONE_OCR_SINGLE_PAGE_RESCUE_ENABLED
  };
}
