import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DbClient } from "../../db/client";
import { documentResults, workerJobSteps } from "../../db/schema";
import type { WorkflowState } from "../types";

interface PersistDuplicateDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
}

function duplicateMarkerKey(state: WorkflowState): string {
  return `duplicates/${state.event.sourceFileId}/${state.event.revision}/duplicate.json`;
}

export function createPersistDuplicateNode(deps: PersistDuplicateDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const artifactKey = duplicateMarkerKey(state);
    const payload = {
      status: "duplicate",
      source: state.source,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      normalized: state.normalized,
      validation: state.validation,
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
      outcome: "Duplicate",
      status: "duplicate",
      finalKey: state.artifactKeys?.renamedPdf,
      reasonCodes: ["duplicate_source_file_revision"],
      payload,
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["duplicate"],
        checks: []
      },
      artifactKey
    });

    await deps.db.insert(workerJobSteps).values({
      jobId: state.jobId,
      stepName: "persist_duplicate",
      status: "duplicate",
      metadata: {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        outcome: "Duplicate",
        artifactKey
      }
    });

    return {
      artifactKeys: {
        ...state.artifactKeys,
        rawResultJson: artifactKey
      },
      decision: {
        terminalStatus: "Duplicate",
        route: "duplicate",
        reasonCodes: ["duplicate_source_file_revision", ...(state.decision?.reasonCodes ?? [])],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision
      }
    };
  };
}
