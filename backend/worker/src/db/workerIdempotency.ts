import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { DbClient } from "./client";
import { workerIdempotency } from "./schema";

export type CanonicalIdempotencyState =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "duplicate"
  | "failed";

export type TerminalIdempotencyState = "success" | "error" | "duplicate";

export interface WorkerEventClaim {
  idempotencyKey: string;
  claimOwner: string;
  jobId: string;
  attemptNumber: number;
  leaseExpiresAt: Date;
}

export type WorkerEventClaimResult =
  | {
      kind: "acquired";
      claim: WorkerEventClaim;
      takeover: boolean;
    }
  | {
      kind: "terminal_replay";
      terminalState: string;
      jobId: string | null;
    }
  | {
      kind: "busy";
      terminalState: string | null;
      claimOwner: string | null;
      leaseExpiresAt: Date | null;
    };

export type WorkerIdempotencyDb = Pick<
  DbClient,
  "insert" | "select" | "update"
>;

export interface ClaimWorkerEventInput {
  idempotencyKey: string;
  claimOwner: string;
  jobId: string;
  leaseDurationSeconds: number;
}

const terminalStates = new Set([
  "success",
  "error",
  "duplicate",
  "Done",
  "Error",
  "Duplicate",
]);

function leaseExpirationSql(leaseDurationSeconds: number) {
  return sql<Date>`clock_timestamp() + make_interval(secs => ${leaseDurationSeconds})`;
}

function activeClaimPredicate(claim: WorkerEventClaim) {
  return and(
    eq(workerIdempotency.idempotencyKey, claim.idempotencyKey),
    eq(workerIdempotency.claimOwner, claim.claimOwner),
    eq(workerIdempotency.attemptNumber, claim.attemptNumber),
    eq(workerIdempotency.terminalState, "running"),
    gt(workerIdempotency.leaseExpiresAt, sql`clock_timestamp()`),
  );
}

export async function claimWorkerEvent(
  db: WorkerIdempotencyDb,
  input: ClaimWorkerEventInput,
): Promise<WorkerEventClaimResult> {
  const leaseExpiresAt = leaseExpirationSql(input.leaseDurationSeconds);
  const now = sql<Date>`clock_timestamp()`;

  const claimed = await db
    .insert(workerIdempotency)
    .values({
      idempotencyKey: input.idempotencyKey,
      jobId: input.jobId,
      terminalState: "running",
      claimOwner: input.claimOwner,
      leaseExpiresAt,
      lastHeartbeatAt: now,
      attemptNumber: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workerIdempotency.idempotencyKey,
      set: {
        jobId: input.jobId,
        terminalState: "running",
        claimOwner: input.claimOwner,
        leaseExpiresAt,
        lastHeartbeatAt: now,
        attemptNumber: sql`${workerIdempotency.attemptNumber} + 1`,
        updatedAt: now,
      },
      setWhere: or(
        inArray(workerIdempotency.terminalState, ["pending", "failed"]),
        and(
          eq(workerIdempotency.terminalState, "running"),
          or(
            isNull(workerIdempotency.leaseExpiresAt),
            lte(workerIdempotency.leaseExpiresAt, sql`clock_timestamp()`),
          ),
        ),
      ),
    })
    .returning({
      idempotencyKey: workerIdempotency.idempotencyKey,
      claimOwner: workerIdempotency.claimOwner,
      jobId: workerIdempotency.jobId,
      attemptNumber: workerIdempotency.attemptNumber,
      leaseExpiresAt: workerIdempotency.leaseExpiresAt,
    });

  const acquired = claimed[0];
  if (acquired) {
    if (!acquired.claimOwner || !acquired.jobId || !acquired.leaseExpiresAt) {
      throw new Error(
        "Atomic worker claim returned incomplete ownership data.",
      );
    }

    return {
      kind: "acquired",
      claim: {
        idempotencyKey: acquired.idempotencyKey,
        claimOwner: acquired.claimOwner,
        jobId: acquired.jobId,
        attemptNumber: acquired.attemptNumber,
        leaseExpiresAt: acquired.leaseExpiresAt,
      },
      takeover: acquired.attemptNumber > 1,
    };
  }

  const existing = await db
    .select({
      terminalState: workerIdempotency.terminalState,
      claimOwner: workerIdempotency.claimOwner,
      jobId: workerIdempotency.jobId,
      leaseExpiresAt: workerIdempotency.leaseExpiresAt,
    })
    .from(workerIdempotency)
    .where(eq(workerIdempotency.idempotencyKey, input.idempotencyKey))
    .limit(1);
  const current = existing[0];

  if (current && terminalStates.has(current.terminalState)) {
    return {
      kind: "terminal_replay",
      terminalState: current.terminalState,
      jobId: current.jobId,
    };
  }

  return {
    kind: "busy",
    terminalState: current?.terminalState ?? null,
    claimOwner: current?.claimOwner ?? null,
    leaseExpiresAt: current?.leaseExpiresAt ?? null,
  };
}

export async function renewWorkerEventClaim(
  db: WorkerIdempotencyDb,
  claim: WorkerEventClaim,
  leaseDurationSeconds: number,
): Promise<Date | null> {
  const now = sql<Date>`clock_timestamp()`;
  const renewed = await db
    .update(workerIdempotency)
    .set({
      leaseExpiresAt: leaseExpirationSql(leaseDurationSeconds),
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(activeClaimPredicate(claim))
    .returning({ leaseExpiresAt: workerIdempotency.leaseExpiresAt });

  return renewed[0]?.leaseExpiresAt ?? null;
}

export async function completeWorkerEventClaim(
  db: WorkerIdempotencyDb,
  claim: WorkerEventClaim,
  terminalState: TerminalIdempotencyState,
): Promise<boolean> {
  return transitionOwnedClaim(db, claim, terminalState);
}

export async function failWorkerEventClaim(
  db: WorkerIdempotencyDb,
  claim: WorkerEventClaim,
): Promise<boolean> {
  return transitionOwnedClaim(db, claim, "failed");
}

async function transitionOwnedClaim(
  db: WorkerIdempotencyDb,
  claim: WorkerEventClaim,
  terminalState: TerminalIdempotencyState | "failed",
): Promise<boolean> {
  const transitioned = await db
    .update(workerIdempotency)
    .set({
      terminalState,
      leaseExpiresAt: null,
      updatedAt: sql<Date>`clock_timestamp()`,
    })
    .where(activeClaimPredicate(claim))
    .returning({ id: workerIdempotency.id });

  return transitioned.length === 1;
}

export interface WorkerIdempotencyRepository {
  claim: typeof claimWorkerEvent;
  renew: typeof renewWorkerEventClaim;
  complete: typeof completeWorkerEventClaim;
  fail: typeof failWorkerEventClaim;
}

export const workerIdempotencyRepository: WorkerIdempotencyRepository = {
  claim: claimWorkerEvent,
  renew: renewWorkerEventClaim,
  complete: completeWorkerEventClaim,
  fail: failWorkerEventClaim,
};
