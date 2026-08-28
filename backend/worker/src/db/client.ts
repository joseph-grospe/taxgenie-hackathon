import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DbClient = NodePgDatabase<typeof schema>;

function shouldUseSsl(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname;

  return !["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function toNodePgConnectionString(databaseUrl: string): string {
  const connectionUrl = new URL(databaseUrl);

  connectionUrl.searchParams.delete("sslmode");
  connectionUrl.searchParams.delete("sslcert");
  connectionUrl.searchParams.delete("sslkey");
  connectionUrl.searchParams.delete("sslrootcert");

  return connectionUrl.toString();
}

export function createDbClient(databaseUrl: string): { db: DbClient; pool: Pool } {
  const pool = new Pool({
    connectionString: toNodePgConnectionString(databaseUrl),
    ssl: shouldUseSsl(databaseUrl)
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });
  const db = drizzle(pool, { schema });

  return { db, pool };
}
