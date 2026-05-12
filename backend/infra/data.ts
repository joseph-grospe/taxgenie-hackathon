import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optionalString, requiredSecret } from "./config";
import type { InfraSizing } from "./sizing";
import type { DataResources, InfraContext, NetworkResources } from "./types";

type LocalDatabaseConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

const fallbackLocalDatabaseUrl =
  "postgresql://taxtrack:taxtrack@localhost:5432/taxtrack";
const drizzleMigrationsRelativePath = "webapp/tax-track/src/lib/migrations";

function resolvePath(candidates: string[], label: string): string {
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(
      `Could not resolve ${label}. Tried:\n${candidates.map((candidate) => `- ${candidate}`).join("\n")}`,
    );
  }
  return resolved;
}

function resolveMigrationsPath(): string {
  return resolvePath(
    [
      path.resolve(process.cwd(), drizzleMigrationsRelativePath),
      path.resolve(process.cwd(), "..", "..", drizzleMigrationsRelativePath),
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        drizzleMigrationsRelativePath,
      ),
    ],
    "Drizzle migrations directory",
  );
}

function resolveMigrationHandler(): string {
  const baseFilePath = resolvePath(
    [
      path.resolve(process.cwd(), "lambda", "db-migrate.ts"),
      path.resolve(process.cwd(), "backend", "infra", "lambda", "db-migrate.ts"),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "lambda", "db-migrate.ts"),
    ],
    "migration Lambda handler source file",
  );

  return `${path.relative(process.cwd(), baseFilePath).replace(/\\/g, "/").replace(/\.ts$/, "")}.handler`;
}

function parseLocalDatabaseUrl(databaseUrl: string): LocalDatabaseConfig {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, "") || "taxtrack";

  return {
    host: parsed.hostname || "localhost",
    port: Number(parsed.port || "5432"),
    database,
    username: decodeURIComponent(parsed.username || "taxtrack"),
    password: decodeURIComponent(parsed.password || "taxtrack"),
  };
}

function isLocalDatabaseHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function buildDatabaseUrl(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
}): string {
  const url = new URL(
    `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${input.port}/${input.database}`,
  );

  if (!isLocalDatabaseHost(input.host)) {
    url.searchParams.set("sslmode", "require");
  }

  return url.toString();
}

function validateRdsPasswordFromEnv(): void {
  const password = process.env.TAXTRACK_DB_PASSWORD;
  if (!password) {
    return;
  }

  const invalidReason =
    password.length < 8 || password.length > 128
      ? "must be 8 to 128 characters long"
      : !/^[\x21-\x7E]+$/.test(password)
        ? "must contain only printable ASCII characters and no spaces"
        : /[\/@" ]/.test(password)
          ? "must not contain '/', '@', double quotes, or spaces"
          : undefined;

  if (invalidReason) {
    throw new Error(`TAXTRACK_DB_PASSWORD is invalid for RDS: ${invalidReason}.`);
  }
}

function computeMigrationsHash(basePath: string): string {
  const hash = crypto.createHash("sha256");
  const stack: string[] = [basePath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current).sort();
      for (const entry of entries) {
        stack.push(path.join(current, entry));
      }
      continue;
    }

    hash.update(path.relative(basePath, current));
    hash.update(fs.readFileSync(current));
  }

  return hash.digest("hex");
}

export function createData(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    sizing: InfraSizing;
  }
): DataResources {
  validateRdsPasswordFromEnv();
  const dbPassword = requiredSecret("dbPassword", "TAXTRACK_DB_PASSWORD");
  const localDatabaseUrl =
    optionalString("localDatabaseUrl", "TAXTRACK_LOCAL_DATABASE_URL") ??
    fallbackLocalDatabaseUrl;
  const localDatabase = parseLocalDatabaseUrl(localDatabaseUrl);
  const drizzleMigrationsPath = resolveMigrationsPath();
  const drizzleMigrationsCopyPath =
    path.relative(process.cwd(), drizzleMigrationsPath).replace(/\\/g, "/") ||
    ".";
  const migrationHandler = resolveMigrationHandler();
  // Keep the new RDS-based Postgres on a distinct component name so SST does not
  // try to upgrade the older Aurora-backed Postgres.v1 component in place.
  const database = new sst.aws.Postgres(`${ctx.namePrefix}-postgres-rds`, {
    version: "17",
    database: "taxtrack",
    username: "taxtrack",
    password: dbPassword,
    instance: input.sizing.database.instance,
    storage: `${input.sizing.database.storageGb} GB`,
    vpc: {
      subnets: [input.network.privateSubnet.id, input.network.privateSubnet2.id],
    },
    transform: {
      instance: (args) => {
        args.vpcSecurityGroupIds = [input.network.rdsSg.id];
        args.publiclyAccessible = false;
        args.backupRetentionPeriod = input.sizing.database.backupRetentionDays;
        args.performanceInsightsEnabled = false;
      },
    },
    dev: {
      host: localDatabase.host,
      port: localDatabase.port,
      database: localDatabase.database,
      username: localDatabase.username,
      password: localDatabase.password,
    },
  });

  const databaseUrl = pulumi
    .all([
      database.username,
      database.password,
      database.host,
      database.port,
      database.database,
    ])
    .apply(
      ([username, password, host, port, dbName]) =>
        buildDatabaseUrl({
          username,
          password,
          host,
          port,
          database: dbName,
        }),
    );

  let migrationInvocation: aws.lambda.Invocation | undefined;
  if (!$dev) {
    const migrationFunction = new sst.aws.Function(`${ctx.namePrefix}-db-migrate`, {
      runtime: "nodejs22.x",
      handler: migrationHandler,
      timeout: "5 minutes",
      memory: "1024 MB",
      environment: {
        DATABASE_URL: databaseUrl,
        DRIZZLE_MIGRATIONS_DIR: "migrations",
      },
      copyFiles: [
        {
          from: drizzleMigrationsCopyPath,
          to: "migrations",
        },
      ],
      vpc: {
        privateSubnets: [input.network.privateSubnet.id, input.network.privateSubnet2.id],
        securityGroups: [input.network.lambdaSg.id],
      },
      dev: false,
    });

    migrationInvocation = new aws.lambda.Invocation(
      `${ctx.namePrefix}-db-migrate-invocation`,
      {
        functionName: migrationFunction.nodes.function.name,
        input: JSON.stringify({
          requestType: "deploy",
          stage: ctx.stage,
        }),
        triggers: {
          migrationHash: computeMigrationsHash(drizzleMigrationsPath),
          databaseHost: database.host,
          databaseName: database.database,
        },
      },
    );
  }

  const storageBucket = new aws.s3.Bucket(`${ctx.namePrefix}-storage`, {
    tags: {
      Name: `${ctx.namePrefix}-storage`,
    },
  });

  new aws.s3.BucketVersioningV2(`${ctx.namePrefix}-storage-versioning`, {
    bucket: storageBucket.id,
    versioningConfiguration: {
      status: "Enabled",
    },
  });

  new aws.s3.BucketCorsConfigurationV2(`${ctx.namePrefix}-storage-cors`, {
    bucket: storageBucket.id,
    corsRules: [
      {
        allowedHeaders: ["*"],
        allowedMethods: ["PUT", "HEAD"],
        allowedOrigins: ["*"],
        exposeHeaders: ["ETag", "x-amz-version-id"],
        maxAgeSeconds: 3000,
      },
    ],
  });

  return {
    database,
    databaseUrl,
    db: {
      host: database.host,
      port: database.port,
      username: database.username,
      database: database.database,
    },
    ...(migrationInvocation ? { migrationInvocation } : {}),
    storageBucket,
  };
}
