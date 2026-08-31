import assert from "node:assert/strict";
import test from "node:test";

import { createDbClient } from "./client";

test("worker pool honors the constrained Neon runtime settings", async () => {
  const { pool } = createDbClient(
    {
      connectionString: "postgresql://taxgenie:secret@localhost:5432/taxgenie",
    },
    {
      PG_POOL_MAX: "2",
      PG_CONNECTION_TIMEOUT_MS: "10000",
      PG_IDLE_TIMEOUT_MS: "10000",
      PG_MAX_LIFETIME_SECONDS: "60",
    },
  );

  try {
    assert.equal(pool.options.max, 2);
    assert.equal(pool.options.connectionTimeoutMillis, 10_000);
    assert.equal(pool.options.idleTimeoutMillis, 10_000);
    assert.equal(pool.options.maxLifetimeSeconds, 60);
    assert.equal(pool.options.keepAlive, true);
  } finally {
    await pool.end();
  }
});
