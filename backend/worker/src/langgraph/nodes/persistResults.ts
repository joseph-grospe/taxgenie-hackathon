import { CopyObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Logger } from "@taxtrack/shared";
import type { DbClient } from "../../db/client";
import { documentResults } from "../../db/schema";
import { extractPeriodEndDate, sanitizeNameToken, sanitizeTin, buildReconciledRevision } from "../utils/parsing";
import type { WorkflowState } from "../types";

interface PersistValidatedDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
  logger: Logger;
}

function buildRenamedPdfKey(sourceFileId: string, revision: string, normalized: Record<string, unknown>): string {
  const payee = sanitizeNameToken(normalized.payeeName ?? normalized.companyName ?? sourceFileId, "PAYEE");
  const tin = sanitizeTin((normalized.payeeTin ?? normalized.companyName ?? "000000000") as string);
  const period = extractPeriodEndDate(normalized.periodEnd ?? normalized.periodCovered);
  const sequence = buildReconciledRevision(revision);
  const periodToken = period ?? "period_unknown";
  const name = `${payee}_${tin || "TIN"}_${periodToken}_${sequence}`;
  return `renamed/${periodToken}/${name}.pdf`;
}

export function createPersistValidatedNode(deps: PersistValidatedDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const basePath = `results/${state.event.sourceFileId}/${state.event.revision}`;
    const rawResultJson = `${basePath}/raw-extraction.json`;
    const finalResultJson = `${basePath}/final-result.json`;
    const reconciliationArtifact = `${basePath}/reconciliation.json`;
    const renamedPdf = buildRenamedPdfKey(state.event.sourceFileId, state.event.revision, state.normalized ?? {});

    const payload = {
      event: state.event,
      extraction: state.extraction,
      masterlistLookup: state.masterlistLookup,
      normalized: state.normalized,
      validation: state.validation,
      decision: state.decision,
      artifactKeys: state.artifactKeys
    };

    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: rawResultJson,
        Body: JSON.stringify({
          stage: "raw",
          source: state.source,
          extraction: state.extraction,
          masterlistLookup: state.masterlistLookup,
          validation: state.validation,
          decision: state.decision,
          generatedAt: new Date().toISOString()
        }),
        ContentType: "application/json"
      })
    );

    await deps.s3.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: finalResultJson,
        Body: JSON.stringify(payload),
        ContentType: "application/json"
      })
    );

    if (state.source) {
      await deps.s3.send(
        new CopyObjectCommand({
          Bucket: deps.bucket,
          CopySource: `${state.source.bucket}/${state.source.key}`,
          Key: renamedPdf
        })
      );
    }

    await deps.db.insert(documentResults).values({
      jobId: state.jobId,
      eventId: state.event.eventId,
      batchId: state.event.batchId,
      uploadId: state.event.uploadId,
      sourceFileId: state.event.sourceFileId,
      revision: state.event.revision,
      outcome: "Done",
      status: "success",
      finalKey: renamedPdf,
      reasonCodes: state.decision?.reasonCodes ?? [],
      payload,
      validation: state.validation ?? {
        status: "invalid",
        reasons: ["missing_validation"],
        checks: []
      },
      artifactKey: finalResultJson
    });

    deps.logger.info("Persisted validated document", {
      jobId: state.jobId,
      sourceFileId: state.event.sourceFileId,
      finalKey: renamedPdf
    });

    return {
      artifactKey: finalResultJson,
      artifactKeys: {
        source: state.artifactKeys?.source,
        rawResultJson,
        finalResultJson,
        renamedPdf,
        reconciliationArtifact
      },
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "reconcile",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        finishedAt: new Date().toISOString()
      }
    };
  };
}
