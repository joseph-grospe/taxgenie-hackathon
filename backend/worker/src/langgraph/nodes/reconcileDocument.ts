import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { DbClient } from "../../db/client";
import type { ReconciliationResult, WorkflowState } from "../types";

interface ReconcileDeps {
  dbClient: DbClient;
  s3: S3Client;
  bucket: string;
}

export function createReconcileNode(_deps: ReconcileDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const reconciliation: ReconciliationResult = {
      status: "skipped",
      reason: "Reconciliation dataset is not yet available for MVP run.",
      artifactKey: `${state.artifactKeys?.rawResultJson ? state.artifactKeys.rawResultJson.replace(/raw-extraction.json$/u, "reconciliation.json") : `results/${state.event.sourceFileId}/${state.event.revision}/reconciliation.json`}`,
      payload: {
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        outcome: "Done",
        note: "Reconciliation is deferred in MVP while upstream books dataset is not present."
      }
    };

    const artifactKey = reconciliation.artifactKey;
    await _deps.s3.send(
      new PutObjectCommand({
        Bucket: _deps.bucket,
        Key: artifactKey,
        Body: JSON.stringify(reconciliation),
        ContentType: "application/json"
      })
    );

    return {
      reconciliation,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: [...(state.decision?.reasonCodes ?? []), "reconciliation_skipped"],
        phase: "reconcile",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        finishedAt: new Date().toISOString()
      },
      artifactKeys: {
        ...state.artifactKeys,
        rawResultJson: state.artifactKeys?.rawResultJson,
        finalResultJson: state.artifactKeys?.finalResultJson,
        reconciliationArtifact: artifactKey
      }
    };
  };
}
