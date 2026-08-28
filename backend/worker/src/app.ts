import express from "express";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { config } from "dotenv";
import { createLogger, loadWorkerEnv } from "@taxgenie/shared";
import { createDbClient } from "./db/client";
import { SqsPoller } from "./consumer/sqsPoller";
import { createMessageHandler } from "./consumer/messageHandler";
import { resolve } from "node:path";
import { createLangSmithTracing } from "./observability/langsmith";

const repoRoot = resolve(process.cwd(), "../..");
const explicitEnvFile = process.env.TAXGENIE_ENV_FILE?.trim();
config({
  path: explicitEnvFile
    ? resolve(repoRoot, explicitEnvFile)
    : resolve(repoRoot, ".env"),
});

const env = loadWorkerEnv();
const logger = createLogger({ component: "async-worker" });
const tracing = createLangSmithTracing(env, logger);

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for worker runtime");
}

const { db, pool } = createDbClient(env.DATABASE_URL);
const sqs = new SQSClient({ region: env.AWS_REGION });
const s3 = new S3Client({ region: env.AWS_REGION });

const messageHandler = createMessageHandler({
  db,
  s3,
  env,
  logger,
  callbacks: tracing.callbacks,
});
const poller = new SqsPoller({
  client: sqs,
  queueUrl: env.SQS_QUEUE_URL,
  waitTimeSeconds: env.SQS_WAIT_TIME_SECONDS,
  visibilityTimeoutSeconds: env.SQS_VISIBILITY_TIMEOUT_SECONDS,
  concurrency: env.WORKER_CONCURRENCY,
  processMessage: messageHandler,
  logger,
});

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ ok: true, ready: true });
  } catch (error) {
    res.status(503).json({
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

function ensureAdmin(req: express.Request, res: express.Response): boolean {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }

  return true;
}

app.post("/admin/pause", async (req, res) => {
  if (!ensureAdmin(req, res)) {
    return;
  }

  poller.pause();
  res.status(200).json({ ok: true, state: "paused" });
});

app.post("/admin/resume", (req, res) => {
  if (!ensureAdmin(req, res)) {
    return;
  }

  poller.resume();
  res.status(200).json({ ok: true, state: "running" });
});

app.post("/admin/drain", async (req, res) => {
  if (!ensureAdmin(req, res)) {
    return;
  }

  await poller.drain();
  res.status(200).json({ ok: true, state: "drained" });
});

const port = env.WORKER_PORT;
app.listen(port, () => {
  logger.info("Worker HTTP server started", { port });
  poller.start();
});

async function shutdown(signal: string): Promise<void> {
  logger.warn("Shutdown requested", { signal });
  try {
    await poller.drain();
  } finally {
    await tracing.flush();
    await pool.end();
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
