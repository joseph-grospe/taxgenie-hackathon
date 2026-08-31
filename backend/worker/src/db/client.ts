import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  resolveDatabaseConnectionConfig,
  type DatabaseConnectionConfig,
} from "@taxgenie/shared";
import * as schema from "./schema";

export type DbClient = NodePgDatabase<typeof schema>;

const parseIntegerEnv = (
  input: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
) => {
  const value = Number.parseInt(input[name]?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export function createDbClient(
  connection:
    | DatabaseConnectionConfig
    | string = resolveDatabaseConnectionConfig(),
  input: NodeJS.ProcessEnv = process.env,
): { db: DbClient; pool: Pool } {
  const resolvedConnection =
    typeof connection === "string"
      ? resolveDatabaseConnectionConfig({ DATABASE_URL: connection })
      : connection;
  const pool = new Pool({
    ...resolvedConnection,
    max: parseIntegerEnv(input, "PG_POOL_MAX", 4),
    connectionTimeoutMillis: parseIntegerEnv(
      input,
      "PG_CONNECTION_TIMEOUT_MS",
      5_000,
    ),
    idleTimeoutMillis: parseIntegerEnv(input, "PG_IDLE_TIMEOUT_MS", 10_000),
    maxLifetimeSeconds: parseIntegerEnv(input, "PG_MAX_LIFETIME_SECONDS", 60),
    query_timeout: parseIntegerEnv(input, "PG_QUERY_TIMEOUT_MS", 10_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    allowExitOnIdle: true,
  });
  pool.on("error", (error) => {
    console.error("Unexpected Postgres pool error in worker runtime.", error);
  });
  const db = drizzle(pool, { schema });

  return { db, pool };
}
