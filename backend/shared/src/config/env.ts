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
  VARIANCE_THRESHOLD_PHP: z.preprocess(parseNumber, z.number().nonnegative().default(100)),
  S3_OBJECT_PREFIX: z.string().min(1).optional(),
  OCR_PROVIDER: z.enum(["azure_foundry", "mistral_direct"]).default("azure_foundry"),
  OCR_TIMEOUT_MS: z.preprocess(parseNumber, z.number().positive().optional()),
  AZURE_FOUNDRY_OCR_API_URL: optionalUrl,
  AZURE_FOUNDRY_OCR_API_KEY: optionalNonEmptyString,
  AZURE_FOUNDRY_OCR_MODEL: optionalNonEmptyString,
  MISTRAL_DIRECT_OCR_API_URL: optionalUrl,
  MISTRAL_DIRECT_OCR_API_KEY: optionalNonEmptyString,
  MISTRAL_DIRECT_OCR_MODEL: optionalNonEmptyString,
  AZURE_API_KEY: optionalNonEmptyString,
  MISTRAL_API_KEY: optionalNonEmptyString,
  MISTRAL_API_URL: optionalUrl,
  MISTRAL_MODEL: optionalNonEmptyString,
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
