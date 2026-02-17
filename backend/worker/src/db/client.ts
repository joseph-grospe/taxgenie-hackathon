import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DbClient = NodePgDatabase<typeof schema>;

export function createDbClient(databaseUrl: string): { db: DbClient; pool: Pool } {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  return { db, pool };
}
