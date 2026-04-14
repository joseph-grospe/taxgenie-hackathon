import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DbClient } from "../../db/client";
import { documentResults } from "../../db/schema";
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
      event: state.event,
      source: state.source,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      extracted: state.extracted,
      extraction: state.extraction,
      masterlistLookup: state.masterlistLookup,
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
      batchId: state.event.batchId,
      uploadId: state.event.uploadId,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      outcome: "Duplicate",
      status: "duplicate",
      finalKey: state.artifactKeys?.renamedPdf,
      reasonCodes: state.decision?.reasonCodes ?? ["duplicate_source_file_revision"],
      payload,
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["duplicate"],
        checks: []
      },
      artifactKey
    });

    return {
      artifactKeys: {
        ...state.artifactKeys,
        rawResultJson: artifactKey
      },
      decision: {
        terminalStatus: "Duplicate",
        route: "duplicate",
        reasonCodes: state.decision?.reasonCodes ?? ["duplicate_source_file_revision"],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision
      }
    };
  };
}
