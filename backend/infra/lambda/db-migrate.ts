import fs from "node:fs";
import path from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";

type MigrationResponse = {
  ok: boolean;
  migrationsFolder: string;
};

const migrationsSchema = "public";
const migrationsTable = "__drizzle_migrations";

type PostgresLikeError = Error & {
  code?: string;
  detail?: string;
  hint?: string;
  schema?: string;
  table?: string;
  routine?: string;
};

function shouldUseSsl(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname;

  return !["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function toNodePgConnectionString(databaseUrl: string): string {
  const connectionUrl = new URL(databaseUrl);

  // pg's connection-string parser lets sslmode override the explicit ssl object.
  // Strip it here so rejectUnauthorized=false is honored for Aurora's CA chain.
  connectionUrl.searchParams.delete("sslmode");
  connectionUrl.searchParams.delete("sslcert");
  connectionUrl.searchParams.delete("sslkey");
  connectionUrl.searchParams.delete("sslrootcert");

  return connectionUrl.toString();
}

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
    connectionString: toNodePgConnectionString(databaseUrl),
    ssl: shouldUseSsl(databaseUrl)
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });

  try {
    const migrations = readMigrationFiles({ migrationsFolder });
    const client = await pool.connect();

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${migrationsSchema}.${migrationsTable} (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint NOT NULL
        )
      `);

      // Required by the initial migration for security_audit_logs.id.
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

      const { rows } = await client.query<{
        id: number;
        hash: string;
        created_at: string;
      }>(
        `
          SELECT id, hash, created_at
          FROM ${migrationsSchema}.${migrationsTable}
          ORDER BY created_at DESC
          LIMIT 1
        `,
      );

      const lastDbMigration = rows[0];

      for (const migration of migrations) {
        if (
          lastDbMigration
          && Number(lastDbMigration.created_at) >= migration.folderMillis
        ) {
          continue;
        }

        await client.query("BEGIN");
        try {
          for (const statement of migration.sql) {
            const normalized = statement.trim();
            if (!normalized) {
              continue;
            }
            await client.query(normalized);
          }

          await client.query(
            `
              INSERT INTO ${migrationsSchema}.${migrationsTable} ("hash", "created_at")
              VALUES ($1, $2)
            `,
            [migration.hash, migration.folderMillis],
          );

          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      client.release();
    }

    return {
      ok: true,
      migrationsFolder,
    };
  } catch (error) {
    const postgresError = error as PostgresLikeError;
    const messageParts = [
      postgresError.message,
      postgresError.code ? `code=${postgresError.code}` : undefined,
      postgresError.detail ? `detail=${postgresError.detail}` : undefined,
      postgresError.hint ? `hint=${postgresError.hint}` : undefined,
      postgresError.schema ? `schema=${postgresError.schema}` : undefined,
      postgresError.table ? `table=${postgresError.table}` : undefined,
      postgresError.routine ? `routine=${postgresError.routine}` : undefined,
    ].filter(Boolean);

    throw new Error(messageParts.join(" | "));
  } finally {
    await pool.end();
  }
}
