import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Logger } from "@taxtrack/shared";
import type { DbClient } from "../../db/client";
import { documentResults, workerJobSteps } from "../../db/schema";
import type { WorkflowState } from "../types";

interface PersistDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
  logger: Logger;
}

export function createPersistResultsNode(deps: PersistDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const artifactKey = state.artifactKey ?? `results/${state.event.sourceFileId}/${state.event.revision}.json`;

    const payload = {
      event: state.event,
      extracted: state.extracted,
      normalized: state.normalized,
      validation: state.validation
    };

    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: artifactKey,
        Body: JSON.stringify(payload),
        ContentType: "application/json"
      })
    );

    await deps.db.insert(documentResults).values({
      jobId: state.jobId,
      eventId: state.event.eventId,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      payload,
      validation: state.validation ?? { status: "invalid", reasons: ["missing_validation"] },
      artifactKey
    });

    await deps.db.insert(workerJobSteps).values({
      jobId: state.jobId,
      stepName: "persist_results",
      status: "success",
      metadata: {
        artifactKey,
        sourceFileId: state.event.sourceFileId
      }
    });

    deps.logger.info("Persisted workflow output", {
      jobId: state.jobId,
      artifactKey
    });

    return { artifactKey };
  };
};
