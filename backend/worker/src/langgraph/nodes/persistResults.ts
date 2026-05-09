import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  buildOptionalCustomerStorageKey,
  buildOptionalEntityStorageKey,
  buildProcessingArtifactKey,
  buildUnsignedCertificateKey,
  type Logger,
} from "@taxtrack/shared";
import { and, eq, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  batchStageTimings,
  documentResults,
  intakeFiles,
} from "../../db/schema";
import {
  applyAutomaticReconciliationMatch,
  resolveAutomaticReconciliationMatchInput,
} from "../../db/reconciliationAutoMatch";
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
type AutomaticReconciliationMatchResult = Awaited<
  ReturnType<typeof applyAutomaticReconciliationMatch>
>;

type AutomaticReconciliationTiming = {
  batchId: string;
  uploadId: string;
  jobId: string;
  documentResultId: number;
  startedAt: Date;
  finishedAt: Date;
  matchInput: NonNullable<
    ReturnType<typeof resolveAutomaticReconciliationMatchInput>
  >;
  result: AutomaticReconciliationMatchResult;
};

interface UploadMonthRange {
  monthKey: string;
  monthStart: Date;
  nextMonthStart: Date;
}

function buildUnsignedCertificateFileName(
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
  return `${name}.pdf`;
}

function formatPeriodKey(raw: unknown): string {
  const isoDate = extractPeriodEndDate(raw);
  if (!isoDate) {
    return "period-unknown";
  }

  const [year, month] = isoDate.split("-");
  return year && month ? `${year}-${month}` : "period-unknown";
}

function getEntityKey(state: WorkflowState): string {
  return buildOptionalEntityStorageKey(state.event.selectedEntity);
}

function getCustomerKey(shortName: string | null | undefined): string {
  return buildOptionalCustomerStorageKey({ shortName });
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
  customerKey: string,
): ArtifactKeys {
  const normalized = (page.normalized ?? {}) as Record<string, unknown>;
  return {
    source: state.artifactKeys?.source,
    rawResultJson: buildProcessingArtifactKey({
      entityKey: getEntityKey(state),
      customerKey,
      batchId: state.event.batchId,
      uploadId: state.event.uploadId,
      revision: state.event.revision,
      fileName: "raw-extraction.json",
    }),
    finalResultJson: buildProcessingArtifactKey({
      entityKey: getEntityKey(state),
      customerKey,
      batchId: state.event.batchId,
      uploadId: state.event.uploadId,
      revision: state.event.revision,
      fileName: "final-result.json",
    }),
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

async function recordAutomaticReconciliationTiming(
  db: DbClient,
  input: AutomaticReconciliationTiming,
) {
  const durationMs = input.finishedAt.getTime() - input.startedAt.getTime();
  if (
    Number.isNaN(input.startedAt.getTime()) ||
    Number.isNaN(input.finishedAt.getTime()) ||
    durationMs < 0
  ) {
    return;
  }

  await db
    .insert(batchStageTimings)
    .values({
      batchId: input.batchId,
      stage: "reconciliation",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs,
      dedupeKey: `reconciliation:auto-match:${input.batchId}:${input.documentResultId}`,
      sourceType: "worker_auto_match",
      sourceId: String(input.documentResultId),
      metadata: {
        jobId: input.jobId,
        uploadId: input.uploadId,
        issuerShortName: input.matchInput.issuerShortName,
        billingMonthMMYY: input.matchInput.billingMonthMMYY,
        status: input.result.status,
        rowId: input.result.status === "matched" ? input.result.rowId : null,
      },
    })
    .onConflictDoNothing({ target: batchStageTimings.dedupeKey });
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
    let automaticReconciliationTiming:
      | AutomaticReconciliationTiming
      | undefined;

    await deps.db.transaction(async (tx) => {
      const customerKey = getCustomerKey(resultColumns.payorShortName);
      const processedNumber = await getNextPayorProcessedNumber(
        tx,
        resultColumns.payorShortName,
        state.event.uploadedAt,
      );
      const currentArtifactKeys = buildCertificateArtifactKeys(
        state,
        page,
        processedNumber,
        customerKey,
      );

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

      const insertedResults = await tx
        .insert(documentResults)
        .values({
          jobId: state.jobId,
          eventId: state.event.eventId,
          batchId: state.event.batchId,
          uploadId: state.event.uploadId,
          sourceFileId: state.event.sourceFileId,
          revision: state.event.revision,
          outcome: "Done",
          status: "success",
          finalKey: null,
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
          payload: {
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
          },
          validation,
          artifactKey: currentArtifactKeys.finalResultJson,
        })
        .returning({ id: documentResults.id });

      const documentResultId = insertedResults.at(0)?.id;
      if (!documentResultId) {
        throw new Error("Persisted certificate without a document result id.");
      }

      const unsignedPdfKey = buildUnsignedCertificateKey({
        entityKey: getEntityKey(state),
        customerKey,
        period: formatPeriodKey(
          normalized.periodEnd ?? normalized.periodCovered,
        ),
        batchId: state.event.batchId,
        documentResultId,
        fileName: buildUnsignedCertificateFileName(
          state.event.sourceFileId,
          normalized,
          processedNumber,
        ),
      });
      const finalizedArtifactKeys = {
        ...currentArtifactKeys,
        renamedPdf: unsignedPdfKey,
      };
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
        artifactKeys: finalizedArtifactKeys,
      };

      await deps.s3.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: finalizedArtifactKeys.finalResultJson,
          Body: JSON.stringify(payload),
          ContentType: "application/json",
        }),
      );

      if (page.sourceContentBase64) {
        await deps.s3.send(
          new PutObjectCommand({
            Bucket: deps.bucket,
            Key: unsignedPdfKey,
            Body: Buffer.from(page.sourceContentBase64, "base64"),
            ContentType: "application/pdf",
          }),
        );
      }

      await tx
        .update(documentResults)
        .set({
          finalKey: unsignedPdfKey,
          payload,
        })
        .where(eq(documentResults.id, documentResultId));

      const reconciliationMatch = resolveAutomaticReconciliationMatchInput({
        originalFileName: state.event.originalFileName,
        normalized,
        payorShortName: resultColumns.payorShortName,
      });

      if (reconciliationMatch) {
        const reconciliationStartedAt = new Date();
        const reconciliationResult = await applyAutomaticReconciliationMatch(
          tx,
          {
            batchId: state.event.batchId,
            documentResultId,
            ...reconciliationMatch,
          },
        );
        const reconciliationFinishedAt = new Date();

        if (reconciliationResult.status === "matched") {
          automaticReconciliationTiming = {
            batchId: state.event.batchId,
            uploadId: state.event.uploadId,
            jobId: state.jobId,
            documentResultId,
            startedAt: reconciliationStartedAt,
            finishedAt: reconciliationFinishedAt,
            matchInput: reconciliationMatch,
            result: reconciliationResult,
          };
        }
      }

      artifactKeys = finalizedArtifactKeys;
    });

    if (automaticReconciliationTiming) {
      try {
        await recordAutomaticReconciliationTiming(
          deps.db,
          automaticReconciliationTiming,
        );
      } catch (error) {
        deps.logger.warn("Unable to record automatic reconciliation timing", {
          jobId: state.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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
