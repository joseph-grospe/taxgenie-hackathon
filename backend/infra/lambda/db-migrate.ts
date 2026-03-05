import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

type MigrationResponse = {
  ok: boolean;
  migrationsFolder: string;
};

export async function handler(): Promise<MigrationResponse> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for migration runner.");
  }

  const migrationsDir =
    process.env.DRIZZLE_MIGRATIONS_DIR?.trim() || "migrations";
  const migrationsFolder = path.resolve(process.cwd(), migrationsDir);
  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(
      `Migration folder not found at "${migrationsFolder}".`,
    );
  }

  const pool = new Pool({
    connectionString: databaseUrl,
  });

  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    return {
      ok: true,
      migrationsFolder,
    };
  } finally {
    await pool.end();
  }
}
