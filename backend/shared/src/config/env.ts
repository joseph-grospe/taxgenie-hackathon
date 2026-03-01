import { z } from "zod";

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}, z.string().url().optional());

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
  TAXTRACK_LANGFUSE_SECRET_KEY: z.string().optional()
});

const LambdaEnvSchema = BaseEnvSchema.extend({
  SQS_QUEUE_URL: z.string().min(1),
  DRIVE_WEBHOOK_SECRET: z.string().min(1),
  S3_BUCKET: z.string().min(1).optional(),
  GOOGLE_WORKSPACE_SERVICE_ACCOUNT_KEY: z.string().min(1).optional()
});

const WorkerEnvSchema = BaseEnvSchema.extend({
  SQS_QUEUE_URL: z.string().min(1),
  SQS_DLQ_URL: z.string().optional(),
  S3_BUCKET: z.string().min(1),
  ADMIN_TOKEN: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
  SQS_WAIT_TIME_SECONDS: z.coerce.number().int().min(1).max(20).default(20),
  SQS_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().min(30).default(300)
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;
export type LambdaEnv = z.infer<typeof LambdaEnvSchema>;
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function loadLambdaEnv(input: NodeJS.ProcessEnv = process.env): LambdaEnv {
  return LambdaEnvSchema.parse(input);
}

export function loadWorkerEnv(input: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return WorkerEnvSchema.parse(input);
}
