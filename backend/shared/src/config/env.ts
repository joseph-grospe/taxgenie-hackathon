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

const parseAtcRatesJson = (value: unknown): Record<string, number> | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as Record<string, number>;
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Invalid ATC_RATES_JSON value");
  }

  const normalized: Record<string, number> = {};
  Object.entries(parsed).forEach(([key, rate]) => {
    if (typeof rate === "number" && Number.isFinite(rate)) {
      normalized[key] = rate;
    }
  });

  return normalized;
};

const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AWS_REGION: z.string().min(1),
  DATABASE_URL: z.string().min(1).optional(),
  LANGFUSE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  LANGFUSE_HOST: optionalUrl,
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  TAXTRACK_LANGFUSE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  TAXTRACK_LANGFUSE_HOST: optionalUrl,
  TAXTRACK_LANGFUSE_PUBLIC_KEY: z.string().optional(),
  TAXTRACK_LANGFUSE_SECRET_KEY: z.string().optional(),
  ATC_RATE_WC160: z.preprocess(parseNumber, z.number().positive().default(0.02)),
  ATC_RATE_WC158: z.preprocess(parseNumber, z.number().positive().default(0.01)),
  ATC_RATE_WC051: z.preprocess(parseNumber, z.number().positive().default(0.15)),
  ATC_RATES_JSON: z.preprocess(
    parseAtcRatesJson,
    z.record(z.string(), z.number()).optional(),
  ),
  VARIANCE_THRESHOLD_PHP: z.preprocess(parseNumber, z.number().nonnegative().default(100)),
  S3_OBJECT_PREFIX: z.string().min(1).optional(),
  AZURE_API_KEY: z.string().min(1).optional(),
  MISTRAL_API_KEY: z.string().min(1).optional(),
  MISTRAL_API_URL: z
    .string()
    .url()
    .optional(),
  MISTRAL_MODEL: z.string().min(1).default("mistral-document-ai-2505"),
  MISTRAL_TIMEOUT_MS: z.preprocess(parseNumber, z.number().positive().default(180000)),
  AZURE_OPENAI_API_KEY: z.string().min(1).optional(),
  AZURE_OPENAI_ENDPOINT: optionalUrl,
  AZURE_OPENAI_DEPLOYMENT_NAME: z.string().min(1).optional(),
  AZURE_OPENAI_API_VERSION: z.string().min(1).optional(),
  AZURE_OPENAI_TIMEOUT_MS: z.preprocess(parseNumber, z.number().positive().default(180000)),
  ZONE_OCR_FALLBACK_ENABLED: z.preprocess(parseBoolean, z.boolean().default(true)),
  ZONE_OCR_DPI: z.preprocess(parseNumber, z.number().int().positive().default(300)),
  ZONE_OCR_RENDER_TIMEOUT_MS: z.preprocess(parseNumber, z.number().positive().default(60000)),
  ZONE_OCR_MAX_ZONES_PER_PAGE: z.preprocess(
    parseNumber,
    z.number().int().positive().default(4),
  ),
  ZONE_OCR_SINGLE_PAGE_RESCUE_ENABLED: z.preprocess(
    parseBoolean,
    z.boolean().default(true),
  )
});

const WorkerEnvSchema = BaseEnvSchema.extend({
  SQS_QUEUE_URL: z.string().min(1),
  SQS_DLQ_URL: z.string().optional(),
  S3_BUCKET_NAME: z.string().min(1),
  ADMIN_TOKEN: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
  SQS_WAIT_TIME_SECONDS: z.coerce.number().int().min(1).max(20).default(20),
  SQS_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().min(30).default(300)
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function loadWorkerEnv(input: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return WorkerEnvSchema.parse(input);
}
