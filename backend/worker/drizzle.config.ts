import { config } from "dotenv";
import { isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Config } from "drizzle-kit";

const repoRoot = resolve(process.cwd(), "../..");
const explicitEnvFile = process.env.TAXGENIE_ENV_FILE?.trim();
const candidateEnvPaths = [
  explicitEnvFile
    ? isAbsolute(explicitEnvFile)
      ? explicitEnvFile
      : resolve(repoRoot, explicitEnvFile)
    : undefined,
  resolve(repoRoot, ".env"),
  resolve(process.cwd(), ".env"),
].filter((candidatePath): candidatePath is string => Boolean(candidatePath));
const envPath = candidateEnvPaths.find((path) => existsSync(path));
if (envPath) {
  config({ path: envPath });
}

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
