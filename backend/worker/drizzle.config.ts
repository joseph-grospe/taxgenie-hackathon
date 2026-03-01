import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Config } from "drizzle-kit";

const candidateEnvPaths = [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")];
const envPath = candidateEnvPaths.find((path) => existsSync(path));
if (envPath) {
  config({ path: envPath });
}

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  },
  strict: true,
  verbose: true
} satisfies Config;
