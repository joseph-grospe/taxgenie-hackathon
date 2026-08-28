import { eq, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { intakeFiles, workerJobs, workerJobSteps } from "./schema";

type StepStatus = "success" | "error" | "duplicate" | "failed";

export async function setJobCurrentStep(
  db: DbClient,
  input: {
    jobId: string;
    uploadId: string;
    phase: string;
    step: string;
  },
) {
  await db
    .update(workerJobs)
    .set({
      currentPhase: input.phase,
      currentStep: input.step,
      updatedAt: new Date(),
    })
    .where(eq(workerJobs.jobId, input.jobId));

  await db
    .update(intakeFiles)
    .set({
      currentPhase: input.phase,
      currentStep: input.step,
      processingStatus: "processing",
      processingStartedAt: sql`COALESCE(${intakeFiles.processingStartedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(eq(intakeFiles.id, input.uploadId));
}

export async function insertWorkerStep(
  db: DbClient,
  input: {
    jobId: string;
    stepName: string;
    status: StepStatus;
    durationMs: number;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert(workerJobSteps).values({
    jobId: input.jobId,
    stepName: input.stepName,
    status: input.status,
    durationMs: input.durationMs,
    metadata: input.metadata,
  });
}
