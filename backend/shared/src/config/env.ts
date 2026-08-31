import { z } from "zod";

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}, z.string().url().optional());

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error("Invalid numeric value");
    }

    return parsed;
  }

  return undefined;
};

const parseBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  throw new Error("Invalid boolean value");
};

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const BaseEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  GCP_REGION: z.string().min(1).default("asia-southeast1"),
  DATABASE_URL: z.string().min(1).optional(),
  TAXGENIE_LANGSMITH_ENABLED: z.preprocess(
    parseBoolean,
    z.boolean().default(false),
  ),
  LANGSMITH_ENDPOINT: optionalUrl,
  LANGSMITH_API_KEY: optionalNonEmptyString,
  LANGSMITH_PROJECT: optionalNonEmptyString,
  VARIANCE_THRESHOLD_PHP: z.preprocess(
    parseNumber,
    z.number().nonnegative().default(100),
  ),
  STORAGE_OBJECT_PREFIX: z.string().min(1).optional(),
  GEMINI_API_KEY: optionalNonEmptyString,
  GEMINI_MODEL: optionalNonEmptyString,
  GEMINI_THINKING_LEVEL: z
    .enum(["minimal", "low", "medium", "high"])
    .default("high"),
  GEMINI_MEDIA_RESOLUTION: z
    .enum(["low", "medium", "high"])
    .default("medium"),
  GEMINI_TIMEOUT_MS: z.preprocess(
    parseNumber,
    z.number().positive().default(180000),
  ),
  SIGNATURE_VISUAL_DETECTOR_ENABLED: z.preprocess(
    parseBoolean,
    z.boolean().default(true),
  ),
  SIGNATURE_VISUAL_MIN_CONFIDENCE: z.preprocess(
    parseNumber,
    z.number().min(0).max(1).default(0.86),
  ),
  SIGNATURE_VISUAL_DPI: z.preprocess(
    parseNumber,
    z.number().int().positive().default(400),
  ),
  SIGNATURE_VISUAL_TIMEOUT_MS: z.preprocess(
    parseNumber,
    z.number().positive().default(60000),
  ),
  PDF_TEXT_LAYER_FALLBACK_ENABLED: z.preprocess(
    parseBoolean,
    z.boolean().default(true),
  ),
  PAYOR_SIGNER_VERIFICATION_ENABLED: z.preprocess(
    parseBoolean,
    z.boolean().default(false),
  ),
  IDENTITY_CONFIDENCE_FLOW_ENABLED: z.preprocess(
    parseBoolean,
    z.boolean().default(true),
  ),
});

const WorkerEnvSchema = BaseEnvSchema.extend({
  STORAGE_BUCKET_NAME: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  WORKER_CLAIM_LEASE_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .default(600),
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function loadWorkerEnv(
  input: NodeJS.ProcessEnv = process.env,
): WorkerEnv {
  return WorkerEnvSchema.parse(input);
}
