import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DbClient } from "../../db/client";
import { documentResults, workerJobSteps } from "../../db/schema";
import type { WorkflowState } from "../types";

interface PersistValidationFailDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
}

function reasonKey(state: WorkflowState): string {
  return `errors/${state.event.sourceFileId}/${state.event.revision}/validation-fail.json`;
}

export function createPersistValidationFailNode(deps: PersistValidationFailDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const artifactKey = reasonKey(state);

    const payload = {
      status: "error",
      event: state.event,
      source: state.source,
      extracted: state.extracted,
      extraction: state.extraction,
      normalized: state.normalized,
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["missing_validation"],
        checks: []
      },
      decision: state.decision,
      createdAt: new Date().toISOString()
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
      outcome: "Error",
      status: "error",
      finalKey: state.artifactKeys?.finalResultJson ?? artifactKey,
      reasonCodes: state.decision?.reasonCodes ?? ["validation_failed"],
      payload,
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["missing_validation"],
        checks: []
      },
      artifactKey
    });

    await deps.db.insert(workerJobSteps).values({
      jobId: state.jobId,
      stepName: "persist_validation_fail",
      status: "error",
      metadata: {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        reasons: state.validation?.reasons ?? [],
        outcome: "Error",
        artifactKey
      }
    });

    return {
      decision: {
        terminalStatus: "Error",
        route: "error",
        reasonCodes: state.decision?.reasonCodes ?? ["validation_failed"],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision
      },
      artifactKeys: {
        ...state.artifactKeys,
        finalResultJson: artifactKey
      }
    };
  };
}
