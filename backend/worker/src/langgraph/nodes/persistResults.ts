import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Logger } from "@taxtrack/shared";
import { and, eq, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { documentResults, intakeFiles } from "../../db/schema";
import {
  extractPeriodEndDate,
  sanitizeNameToken,
  sanitizeTin,
} from "../utils/parsing";
import type { ArtifactKeys, WorkflowPageState, WorkflowState } from "../types";
import { buildNormalizedDataFingerprint } from "../utils/dedupe";
import { buildDocumentResultColumns } from "../utils/documentResultColumns";

interface PersistValidatedDeps {
  db: DbClient;
  s3: S3Client;
  bucket: string;
  logger: Logger;
}

type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

interface UploadMonthRange {
  monthKey: string;
  monthStart: Date;
  nextMonthStart: Date;
}

function buildRenamedPdfKey(
  sourceFileId: string,
  normalized: Record<string, unknown>,
  processedNumber: number,
): string {
  const payee = sanitizeNameToken(
    normalized.payorName ?? normalized.companyName ?? sourceFileId,
    "PAYEE",
  );
  const tin = sanitizeTin(
    (normalized.payorTin ?? normalized.companyName ?? "000000000") as string,
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

function buildCertificateArtifactKeys(
  state: WorkflowState,
  page: WorkflowPageState,
  processedNumber: number,
): ArtifactKeys {
  const basePath = `results/${state.event.sourceFileId}/${state.event.revision}`;
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

function getUploadMonthRange(
  uploadedAt: string | undefined,
): UploadMonthRange | null {
  if (!uploadedAt) {
    return null;
  }

  const uploadDate = new Date(uploadedAt);
  if (Number.isNaN(uploadDate.getTime())) {
    return null;
  }

  const year = uploadDate.getUTCFullYear();
  const month = uploadDate.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, month, 1));
  const nextMonthStart = new Date(Date.UTC(year, month + 1, 1));

  return {
    monthKey: `${year}-${String(month + 1).padStart(2, "0")}`,
    monthStart,
    nextMonthStart,
  };
}

async function getNextPayorProcessedNumber(
  tx: DbTransaction,
  payorShortName: string | null,
  uploadedAt: string | undefined,
): Promise<number> {
  const uploadMonthRange = getUploadMonthRange(uploadedAt);
  if (!payorShortName || !uploadMonthRange) {
    return 1;
  }

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`processed-number:${payorShortName}:${uploadMonthRange.monthKey}`}))`,
  );

  const rows = await tx
    .select({
      processedCount: sql<number>`count(*)::int`,
    })
    .from(documentResults)
    .innerJoin(intakeFiles, eq(documentResults.uploadId, intakeFiles.id))
    .where(
      and(
        eq(documentResults.payorShortName, payorShortName),
        eq(documentResults.outcome, "Done"),
        eq(documentResults.status, "success"),
        sql`${intakeFiles.uploadedAt} >= ${uploadMonthRange.monthStart}`,
        sql`${intakeFiles.uploadedAt} < ${uploadMonthRange.nextMonthStart}`,
      ),
    );

  return Number(rows[0]?.processedCount ?? 0) + 1;
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

    if (certificatePages.length > 1) {
      throw new Error(
        "Cannot persist more than one certificate result for a single upload.",
      );
    }

    const page = certificatePages[0];
    const normalized = (page.normalized ?? {}) as Record<string, unknown>;
    const dataFingerprint = buildNormalizedDataFingerprint(normalized);
    const dedupe = {
      originalFileName: state.event.originalFileName,
      sourceHash: state.source?.hash ?? null,
      dataFingerprint: dataFingerprint ?? null,
    };
    const validation = (page.validation ?? {
      status: "invalid",
      reasons: ["missing_validation"],
      checks: [],
    }) as Record<string, unknown>;
    const resultColumns = await buildDocumentResultColumns(deps.db, normalized);

    let artifactKeys: ArtifactKeys | undefined;

    await deps.db.transaction(async (tx) => {
      const processedNumber = await getNextPayorProcessedNumber(
        tx,
        resultColumns.payorShortName,
        state.event.uploadedAt,
      );
      const currentArtifactKeys = buildCertificateArtifactKeys(
        state,
        page,
        processedNumber,
      );
      const payload = {
        event: state.event,
        source: state.source,
        certificatePageNumber: page.pageNumber,
        batchSummary: state.batchSummary,
        extraction: page.extraction,
        masterlistLookup: page.masterlistLookup,
        normalized: page.normalized,
        validation: page.validation,
        decision: page.decision ?? state.decision,
        dedupe,
        artifactKeys: currentArtifactKeys,
      };

      await deps.s3.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: currentArtifactKeys.rawResultJson,
          Body: JSON.stringify({
            stage: "raw",
            certificatePageNumber: page.pageNumber,
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
          Key: currentArtifactKeys.finalResultJson,
          Body: JSON.stringify(payload),
          ContentType: "application/json",
        }),
      );

      if (page.sourceContentBase64) {
        await deps.s3.send(
          new PutObjectCommand({
            Bucket: deps.bucket,
            Key: currentArtifactKeys.renamedPdf,
            Body: Buffer.from(page.sourceContentBase64, "base64"),
            ContentType: "application/pdf",
          }),
        );
      }

      await tx.insert(documentResults).values({
        jobId: state.jobId,
        eventId: state.event.eventId,
        batchId: state.event.batchId,
        uploadId: state.event.uploadId,
        sourceFileId: state.event.sourceFileId,
        revision: state.event.revision,
        outcome: "Done",
        status: "success",
        finalKey: currentArtifactKeys.renamedPdf,
        originalFileName: dedupe.originalFileName,
        sourceHash: dedupe.sourceHash,
        dataFingerprint: dedupe.dataFingerprint,
        periodEnd: resultColumns.periodEnd,
        payeeName: resultColumns.payeeName,
        payeeTin: resultColumns.payeeTin,
        payeeShortName: resultColumns.payeeShortName,
        payorName: resultColumns.payorName,
        payorTin: resultColumns.payorTin,
        payorShortName: resultColumns.payorShortName,
        reasonCodes: state.decision?.reasonCodes ?? [],
        payload,
        validation,
        artifactKey: currentArtifactKeys.finalResultJson,
      });

      artifactKeys = currentArtifactKeys;
    });

    if (!artifactKeys) {
      throw new Error("Persisted certificate without artifact keys.");
    }

    deps.logger.info("Persisted validated certificate", {
      jobId: state.jobId,
      sourceFileId: state.event.sourceFileId,
      certificatePageNumber: page.pageNumber,
    });

    return {
      artifactKey: artifactKeys.finalResultJson,
      artifactKeys,
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
