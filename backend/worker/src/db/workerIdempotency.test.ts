import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createDbClient } from "./client.ts";
import {
  claimWorkerEvent,
  completeWorkerEventClaim,
  failWorkerEventClaim,
  renewWorkerEventClaim,
} from "./workerIdempotency.ts";

const databaseUrl = process.env.WORKER_IDEMPOTENCY_TEST_DATABASE_URL;

test(
  "atomic worker claims serialize concurrent delivery and fence stale owners",
  {
    skip: databaseUrl
      ? false
      : "WORKER_IDEMPOTENCY_TEST_DATABASE_URL is not set",
  },
  async () => {
    assert.ok(databaseUrl);
    const { db, pool } = createDbClient(databaseUrl);
    const concurrentKey = `test:worker-claim:${randomUUID()}`;
    const takeoverKey = `test:worker-takeover:${randomUUID()}`;
    const pendingKey = `test:worker-pending:${randomUUID()}`;
    const failedKey = `test:worker-failed:${randomUUID()}`;
    const legacyTerminalKey = `test:worker-legacy-terminal:${randomUUID()}`;

    try {
      const concurrentClaims = await Promise.all([
        claimWorkerEvent(db, {
          idempotencyKey: concurrentKey,
          claimOwner: randomUUID(),
          jobId: `job_${randomUUID()}`,
          leaseDurationSeconds: 60,
        }),
        claimWorkerEvent(db, {
          idempotencyKey: concurrentKey,
          claimOwner: randomUUID(),
          jobId: `job_${randomUUID()}`,
          leaseDurationSeconds: 60,
        }),
      ]);

      assert.equal(
        concurrentClaims.filter((claim) => claim.kind === "acquired").length,
        1,
      );
      assert.equal(
        concurrentClaims.filter((claim) => claim.kind === "busy").length,
        1,
      );

      const acquired = concurrentClaims.find(
        (claim) => claim.kind === "acquired",
      );
      assert.ok(acquired && acquired.kind === "acquired");
      assert.equal(acquired.claim.attemptNumber, 1);
      assert.equal(
        await completeWorkerEventClaim(db, acquired.claim, "success"),
        true,
      );

      const replay = await claimWorkerEvent(db, {
        idempotencyKey: concurrentKey,
        claimOwner: randomUUID(),
        jobId: `job_${randomUUID()}`,
        leaseDurationSeconds: 60,
      });
      assert.equal(replay.kind, "terminal_replay");

      await pool.query(
        `
          INSERT INTO worker_idempotency (
            idempotency_key,
            terminal_state,
            attempt_number
          ) VALUES ($1, 'pending', 0)
        `,
        [pendingKey],
      );
      const pendingClaim = await claimWorkerEvent(db, {
        idempotencyKey: pendingKey,
        claimOwner: randomUUID(),
        jobId: `job_${randomUUID()}`,
        leaseDurationSeconds: 60,
      });
      assert.ok(pendingClaim.kind === "acquired");
      assert.equal(pendingClaim.claim.attemptNumber, 1);

      const failedInitial = await claimWorkerEvent(db, {
        idempotencyKey: failedKey,
        claimOwner: randomUUID(),
        jobId: `job_${randomUUID()}`,
        leaseDurationSeconds: 60,
      });
      assert.ok(failedInitial.kind === "acquired");
      assert.equal(await failWorkerEventClaim(db, failedInitial.claim), true);
      const failedRetry = await claimWorkerEvent(db, {
        idempotencyKey: failedKey,
        claimOwner: randomUUID(),
        jobId: `job_${randomUUID()}`,
        leaseDurationSeconds: 60,
      });
      assert.ok(failedRetry.kind === "acquired");
      assert.equal(failedRetry.claim.attemptNumber, 2);

      await pool.query(
        `
          INSERT INTO worker_idempotency (
            idempotency_key,
            terminal_state,
            attempt_number
          ) VALUES ($1, 'Done', 1)
        `,
        [legacyTerminalKey],
      );
      const legacyReplay = await claimWorkerEvent(db, {
        idempotencyKey: legacyTerminalKey,
        claimOwner: randomUUID(),
        jobId: `job_${randomUUID()}`,
        leaseDurationSeconds: 60,
      });
      assert.equal(legacyReplay.kind, "terminal_replay");

      const initial = await claimWorkerEvent(db, {
        idempotencyKey: takeoverKey,
        claimOwner: randomUUID(),
        jobId: `job_${randomUUID()}`,
        leaseDurationSeconds: 60,
      });
      assert.ok(initial.kind === "acquired");

      await pool.query(
        `
          UPDATE worker_idempotency
          SET lease_expires_at = clock_timestamp() - interval '1 second'
          WHERE idempotency_key = $1
        `,
        [takeoverKey],
      );

      const takeoverClaims = await Promise.all([
        claimWorkerEvent(db, {
          idempotencyKey: takeoverKey,
          claimOwner: randomUUID(),
          jobId: `job_${randomUUID()}`,
          leaseDurationSeconds: 60,
        }),
        claimWorkerEvent(db, {
          idempotencyKey: takeoverKey,
          claimOwner: randomUUID(),
          jobId: `job_${randomUUID()}`,
          leaseDurationSeconds: 60,
        }),
      ]);

      assert.equal(
        takeoverClaims.filter((claim) => claim.kind === "acquired").length,
        1,
      );
      assert.equal(
        takeoverClaims.filter((claim) => claim.kind === "busy").length,
        1,
      );

      const takeover = takeoverClaims.find(
        (claim) => claim.kind === "acquired",
      );
      assert.ok(takeover && takeover.kind === "acquired");
      assert.equal(takeover.takeover, true);
      assert.equal(takeover.claim.attemptNumber, 2);
      assert.equal(await renewWorkerEventClaim(db, initial.claim, 60), null);
      assert.equal(
        await completeWorkerEventClaim(db, initial.claim, "success"),
        false,
      );
      assert.equal(await failWorkerEventClaim(db, initial.claim), false);
      assert.ok(await renewWorkerEventClaim(db, takeover.claim, 60));
    } finally {
      await pool.query(
        `DELETE FROM worker_idempotency WHERE idempotency_key = ANY($1::text[])`,
        [
          [
            concurrentKey,
            takeoverKey,
            pendingKey,
            failedKey,
            legacyTerminalKey,
          ],
        ],
      );
      await pool.end();
    }
  },
);
