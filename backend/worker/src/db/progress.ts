import { eq, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { intakeBatches, intakeFiles, workerJobs, workerJobSteps } from "./schema";

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

export async function refreshBatchStatus(db: DbClient, batchId: string) {
  const files = await db
    .select({
      uploadStatus: intakeFiles.uploadStatus,
      queueStatus: intakeFiles.queueStatus,
      processingStatus: intakeFiles.processingStatus,
    })
    .from(intakeFiles)
    .where(eq(intakeFiles.batchId, batchId));

  const total = files.length;
  const completed = files.filter((file) =>
    ["success", "duplicate", "error"].includes(file.processingStatus),
  ).length;
  const anyProcessing = files.some((file) => file.processingStatus === "processing");
  const anyQueued = files.some((file) =>
    ["sending", "queued"].includes(file.queueStatus),
  );
  const anyUploadPending = files.some((file) => file.uploadStatus !== "uploaded");
  const anyErrors = files.some((file) => file.processingStatus === "error");

  let status = "pending";
  if (total > 0 && completed === total) {
    status = anyErrors ? "completed_with_errors" : "completed";
  } else if (anyProcessing) {
    status = "processing";
  } else if (anyQueued) {
    status = "queued";
  } else if (anyUploadPending) {
    status = "pending";
  }

  await db
    .update(intakeBatches)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(intakeBatches.id, batchId));
}
