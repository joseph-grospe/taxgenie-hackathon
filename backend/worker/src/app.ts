import { resolve } from "node:path";
import { config } from "dotenv";
import {
  createLogger,
  GoogleCloudObjectStorage,
  loadWorkerEnv,
  resolveDatabaseConnectionConfig,
} from "@taxgenie/shared";
import { createMessageHandler } from "./consumer/messageHandler";
import { createDbClient } from "./db/client";
import { createWorkerHttpServer } from "./httpServer";
import { createLangSmithTracing } from "./observability/langsmith";

const repoRoot = resolve(process.cwd(), "../..");
const explicitEnvFile = process.env.TAXGENIE_ENV_FILE?.trim();
config({
  path: explicitEnvFile
    ? resolve(repoRoot, explicitEnvFile)
    : resolve(repoRoot, ".env"),
});

const env = loadWorkerEnv();
const logger = createLogger({ component: "cloud-run-worker" });
const tracing = createLangSmithTracing(env, logger);
const { db, pool } = createDbClient(resolveDatabaseConnectionConfig());
const storage = new GoogleCloudObjectStorage();
const processTask = createMessageHandler({
  db,
  storage,
  env,
  logger,
  callbacks: tracing.callbacks,
});
const app = createWorkerHttpServer({ processTask, pool, logger });
const server = app.listen(env.PORT, () => {
  logger.info("Worker HTTP server started", { port: env.PORT });
});

async function shutdown(signal: string): Promise<void> {
  logger.warn("Shutdown requested", { signal });
  server.close();
  await tracing.flush();
  await pool.end();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
