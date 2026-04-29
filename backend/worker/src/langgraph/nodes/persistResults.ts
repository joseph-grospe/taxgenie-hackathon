import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Logger } from "@taxtrack/shared";
import type { DbClient } from "../../db/client";
import { documentResults } from "../../db/schema";
import {
  extractPeriodEndDate,
  sanitizeNameToken,
  sanitizeTin,
} from "../utils/parsing";
import type { ArtifactKeys, WorkflowPageState, WorkflowState } from "../types";
import { buildNormalizedDataFingerprint } from "../utils/dedupe";

interface PersistValidatedDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
  logger: Logger;
}

function buildRenamedPdfKey(
  sourceFileId: string,
  normalized: Record<string, unknown>,
  processedNumber: number,
): string {
  const payee = sanitizeNameToken(
    normalized.payeeName ?? normalized.companyName ?? sourceFileId,
    "PAYEE",
  );
  const tin = sanitizeTin(
    (normalized.payeeTin ?? normalized.companyName ?? "000000000") as string,
  );
  const periodToken = formatPeriodToken(
    normalized.periodEnd ?? normalized.periodCovered,
  ).replace(/[\s/-]+/gu, "");
  const name = `${payee}_${tin || "TIN"}_${periodToken}_${processedNumber}`;
  return `renamed/${periodToken}/${name}.pdf`;
}

function formatPeriodToken(raw: unknown): string {
  const isoDate = extractPeriodEndDate(raw);
  if (!isoDate) {
    return "period_unknown";
  }

  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) {
    return "period_unknown";
  }

  return `${month}${day}${year}`;
}

function buildPageArtifactKeys(
  state: WorkflowState,
  page: WorkflowPageState,
  processedNumber: number,
): ArtifactKeys {
  const basePath = `results/${state.event.sourceFileId}/${state.event.revision}/pages/${page.pageNumber}`;
  const normalized = (page.normalized ?? {}) as Record<string, unknown>;
  return {
    source: state.artifactKeys?.source,
    rawResultJson: `${basePath}/raw-extraction.json`,
    finalResultJson: `${basePath}/final-result.json`,
    renamedPdf: buildRenamedPdfKey(
      state.event.sourceFileId,
      normalized,
      processedNumber,
    ),
  };
}

export function createPersistValidatedNode(deps: PersistValidatedDeps) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const certificatePages = (state.pages ?? []).filter(
      (page) => page.classification === "certificate",
    );

    if (certificatePages.length === 0) {
      throw new Error(
        "Cannot persist validated results without certificate pages.",
      );
    }

    const persistedPages: Array<{
      pageNumber: number;
      artifactKeys: ArtifactKeys;
      payload: Record<string, unknown>;
      dedupe: {
        originalFileName: string;
        sourceHash: string | null;
        dataFingerprint: string | null;
      };
      validation: Record<string, unknown>;
    }> = [];

    for (const [index, page] of certificatePages.entries()) {
      const processedNumber = index + 1;
      const artifactKeys = buildPageArtifactKeys(state, page, processedNumber);
      const dataFingerprint = buildNormalizedDataFingerprint(
        (page.normalized ?? {}) as Record<string, unknown>,
      );
      const dedupe = {
        originalFileName: state.event.originalFileName,
        sourceHash: state.source?.hash ?? null,
        dataFingerprint: dataFingerprint ?? null,
      };
      const payload = {
        event: state.event,
        source: state.source,
        pageNumber: page.pageNumber,
        processedNumber,
        batchSummary: state.batchSummary,
        extraction: page.extraction,
        masterlistLookup: page.masterlistLookup,
        normalized: page.normalized,
        validation: page.validation,
        decision: page.decision ?? state.decision,
        dedupe,
        artifactKeys,
      };

      await deps.s3.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: artifactKeys.rawResultJson,
          Body: JSON.stringify({
            stage: "raw",
            pageNumber: page.pageNumber,
            source: state.source,
            extraction: page.extraction,
            generatedAt: new Date().toISOString(),
          }),
          ContentType: "application/json",
        }),
      );

      await deps.s3.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: artifactKeys.finalResultJson,
          Body: JSON.stringify(payload),
          ContentType: "application/json",
        }),
      );

      if (page.sourceContentBase64) {
        await deps.s3.send(
          new PutObjectCommand({
            Bucket: deps.bucket,
            Key: artifactKeys.renamedPdf,
            Body: Buffer.from(page.sourceContentBase64, "base64"),
            ContentType: "application/pdf",
          }),
        );
      }

      persistedPages.push({
        pageNumber: page.pageNumber,
        artifactKeys,
        payload,
        dedupe,
        validation: (page.validation ?? {
          status: "invalid",
          reasons: ["missing_validation"],
          checks: [],
        }) as Record<string, unknown>,
      });
    }

    await deps.db.transaction(async (tx) => {
      for (const page of persistedPages) {
        await tx.insert(documentResults).values({
          jobId: state.jobId,
          eventId: state.event.eventId,
          batchId: state.event.batchId,
          uploadId: state.event.uploadId,
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
          documentKind: "certificate",
          pageNumber: page.pageNumber,
          outcome: "Done",
          status: "success",
          finalKey: page.artifactKeys.renamedPdf,
          originalFileName: page.dedupe.originalFileName,
          sourceHash: page.dedupe.sourceHash,
          dataFingerprint: page.dedupe.dataFingerprint,
          reasonCodes: state.decision?.reasonCodes ?? [],
          payload: page.payload,
          validation: page.validation,
          artifactKey: page.artifactKeys.finalResultJson,
        });
      }
    });

    const primaryPage = persistedPages[0];

    deps.logger.info("Persisted validated certificate pages", {
      jobId: state.jobId,
      sourceFileId: state.event.sourceFileId,
      pageNumbers: persistedPages.map((page) => page.pageNumber),
    });

    return {
      artifactKey: primaryPage?.artifactKeys.finalResultJson,
      artifactKeys: primaryPage?.artifactKeys,
      decision: {
        terminalStatus: "Done",
        route: "continue",
        reasonCodes: state.decision?.reasonCodes ?? [],
        phase: "persist",
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        finishedAt: new Date().toISOString(),
      },
    };
  };
}
