import assert from "node:assert/strict";
import test from "node:test";

import { resolveDatabaseConnectionConfig } from "./database";

test("database config uses Cloud SQL's managed Unix socket", () => {
  assert.deepEqual(
    resolveDatabaseConnectionConfig({
      INSTANCE_UNIX_SOCKET: "/cloudsql/project:region:instance",
      DB_NAME: "taxgenie",
      DB_USER: "taxgenie_app",
      DB_PASSWORD: "secret",
    }),
    {
      host: "/cloudsql/project:region:instance",
      port: 5432,
      database: "taxgenie",
      user: "taxgenie_app",
      password: "secret",
    },
  );
});

test("database config keeps DATABASE_URL as the local fallback", () => {
  assert.deepEqual(
    resolveDatabaseConnectionConfig({
      DATABASE_URL: "postgresql://taxgenie:secret@localhost:5432/taxgenie",
    }),
    {
      connectionString: "postgresql://taxgenie:secret@localhost:5432/taxgenie",
      ssl: undefined,
    },
  );
});

test("database config enables verified TLS and channel binding for external URLs", () => {
  assert.deepEqual(
    resolveDatabaseConnectionConfig({
      DATABASE_URL:
        "postgresql://taxgenie:secret@db.example.test:5432/taxgenie?sslmode=require",
    }),
    {
      connectionString:
        "postgresql://taxgenie:secret@db.example.test:5432/taxgenie",
      ssl: { rejectUnauthorized: true },
      enableChannelBinding: true,
    },
  );
});

test("database config strips Neon TLS query parameters before applying pg TLS", () => {
  assert.deepEqual(
    resolveDatabaseConnectionConfig({
      DATABASE_URL:
        "postgresql://taxgenie:secret@ep-example.ap-southeast-1.aws.neon.tech/taxgenie?sslmode=require&channel_binding=require",
    }),
    {
      connectionString:
        "postgresql://taxgenie:secret@ep-example.ap-southeast-1.aws.neon.tech/taxgenie",
      ssl: { rejectUnauthorized: true },
      enableChannelBinding: true,
    },
  );
});
