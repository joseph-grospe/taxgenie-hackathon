import assert from "node:assert/strict";
import test from "node:test";

import type { Logger } from "@taxgenie/shared";
import {
  ClaimOwnershipLostError,
  startClaimLeaseHeartbeat,
} from "./claimLeaseHeartbeat.ts";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

const context = {
  eventId: "event-1",
  jobId: "job-1",
  claimOwner: "owner-1",
  attemptNumber: 1,
};

test("claim heartbeat renews a live lease", async () => {
  let renewCount = 0;
  let resolveRenewed!: () => void;
  const renewed = new Promise<void>((resolve) => {
    resolveRenewed = resolve;
  });
  const heartbeat = startClaimLeaseHeartbeat({
    renew: async () => {
      renewCount += 1;
      resolveRenewed();
      return new Date(Date.now() + 1_000);
    },
    initialLeaseExpiresAt: new Date(Date.now() + 1_000),
    heartbeatIntervalMs: 5,
    retryDelayMs: 5,
    logger,
    context,
    onOwnershipLost: () => assert.fail("ownership should remain live"),
  });

  await renewed;
  await heartbeat.stop();
  assert.equal(renewCount, 1);
  assert.equal(heartbeat.hasLostOwnership(), false);
});

test("claim heartbeat reports ownership loss when renewal is fenced out", async () => {
  let resolveLost!: (error: ClaimOwnershipLostError) => void;
  const lost = new Promise<ClaimOwnershipLostError>((resolve) => {
    resolveLost = resolve;
  });
  const heartbeat = startClaimLeaseHeartbeat({
    renew: async () => null,
    initialLeaseExpiresAt: new Date(Date.now() + 1_000),
    heartbeatIntervalMs: 5,
    retryDelayMs: 5,
    logger,
    context,
    onOwnershipLost: resolveLost,
  });

  const error = await lost;
  await heartbeat.stop();
  assert.ok(error instanceof ClaimOwnershipLostError);
  assert.equal(heartbeat.hasLostOwnership(), true);
});

test("claim heartbeat reports ownership loss when database errors reach the lease expiry", async () => {
  const leaseExpiresAt = new Date("2026-07-13T00:00:01.000Z");
  let resolveLost!: (error: ClaimOwnershipLostError) => void;
  const lost = new Promise<ClaimOwnershipLostError>((resolve) => {
    resolveLost = resolve;
  });
  const heartbeat = startClaimLeaseHeartbeat({
    renew: async () => {
      throw new Error("database unavailable");
    },
    initialLeaseExpiresAt: leaseExpiresAt,
    heartbeatIntervalMs: 5,
    retryDelayMs: 5,
    now: () => leaseExpiresAt.getTime(),
    logger,
    context,
    onOwnershipLost: resolveLost,
  });

  const error = await lost;
  await heartbeat.stop();
  assert.match(error.message, /expired after repeated heartbeat failures/);
  assert.equal(heartbeat.hasLostOwnership(), true);
});
