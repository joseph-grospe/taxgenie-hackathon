import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { DocumentIngestEventV1, Logger } from "@taxtrack/shared";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import type { DbClient } from "../db/client.ts";
import { createDbClient } from "../db/client.ts";
import { splitPdfPages } from "../langgraph/utils/pageProcessing.ts";
import {
  createResultPersistenceService,
  PersistenceBlockedError,
  PersistenceOwnershipLostError,
} from "./resultPersistence.ts";
import type { PrepareResultPersistenceInput } from "./types.ts";

const databaseUrl = process.env.RESULT_PERSISTENCE_TEST_DATABASE_URL;

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function checksum(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

interface StoredObject {
  body: Buffer;
  contentType?: string;
  metadata: Record<string, string>;
  puts: number;
}

class StatefulFakeS3 {
  private readonly objects = new Map<string, StoredObject>();
  private readonly transientPutFailures = new Set<string>();
  private transientPdfPutFailure = false;

  readonly client = {
    send: (command: unknown) => this.send(command),
  } as unknown as S3Client;

  seed(bucket: string, key: string, body: Buffer): void {
    this.objects.set(`${bucket}/${key}`, {
      body,
      metadata: {},
      puts: 0,
    });
  }

  failNextPut(bucket: string, key: string): void {
    this.transientPutFailures.add(`${bucket}/${key}`);
  }

  failNextPdfPut(): void {
    this.transientPdfPutFailure = true;
  }

  body(bucket: string, key: string): Buffer | undefined {
    return this.objects.get(`${bucket}/${key}`)?.body;
  }

  putCount(bucket: string, key: string): number {
    return this.objects.get(`${bucket}/${key}`)?.puts ?? 0;
  }

  private async send(command: unknown): Promise<Record<string, unknown>> {
    if (command instanceof HeadObjectCommand) {
      const id = `${command.input.Bucket}/${command.input.Key}`;
      const object = this.objects.get(id);
      if (!object) {
        throw Object.assign(new Error("not found"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        });
      }
      return {
        ContentLength: object.body.length,
        ContentType: object.contentType,
        Metadata: object.metadata,
      };
    }

    if (command instanceof GetObjectCommand) {
      const id = `${command.input.Bucket}/${command.input.Key}`;
      const object = this.objects.get(id);
      if (!object) {
        throw Object.assign(new Error("not found"), {
          name: "NoSuchKey",
          $metadata: { httpStatusCode: 404 },
        });
      }
      return {
        Body: {
          transformToByteArray: async () => new Uint8Array(object.body),
        },
      };
    }

    if (command instanceof PutObjectCommand) {
      const bucket = String(command.input.Bucket);
      const key = String(command.input.Key);
      const id = `${bucket}/${key}`;
      if (
        this.transientPdfPutFailure &&
        command.input.ContentType === "application/pdf"
      ) {
        this.transientPdfPutFailure = false;
        throw new Error(`injected PDF put failure for ${id}`);
      }
      if (this.transientPutFailures.delete(id)) {
        throw new Error(`injected put failure for ${id}`);
      }
      if (command.input.IfNoneMatch === "*" && this.objects.has(id)) {
        throw Object.assign(new Error("precondition failed"), {
          name: "PreconditionFailed",
          $metadata: { httpStatusCode: 412 },
        });
      }
      const body = Buffer.isBuffer(command.input.Body)
        ? command.input.Body
        : Buffer.from(command.input.Body as Uint8Array);
      this.objects.set(id, {
        body,
        contentType: command.input.ContentType,
        metadata: { ...(command.input.Metadata ?? {}) },
        puts: (this.objects.get(id)?.puts ?? 0) + 1,
      });
      return {};
    }

    throw new Error(`Unsupported S3 command: ${String(command)}`);
  }
}

async function createPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  return Buffer.from(await document.save());
}

function createEvent(input: {
  eventId: string;
  batchId: string;
  uploadId: string;
}): DocumentIngestEventV1 {
  return {
    version: "v1",
    eventId: input.eventId,
    traceId: `trace-${input.eventId}`,
    source: "manual-upload",
    batchId: input.batchId,
    uploadId: input.uploadId,
    sourceFileId: `source-${input.eventId}`,
    revision: "v1",
    originalFileName: "certificate.pdf",
    modifiedTime: "2026-07-13T00:00:00.000Z",
    mimeType: "application/pdf",
    sizeBytes: 100,
    artifactUri: `s3://source-bucket/${input.uploadId}.pdf`,
    uploadedByUserId: "persistence-test-user",
    uploadedAt: "2026-07-13T00:00:00.000Z",
    receivedAt: "2026-07-13T00:00:00.000Z",
  };
}

async function seedFixture(
  pool: ReturnType<typeof createDbClient>["pool"],
  event: DocumentIngestEventV1,
  jobId: string,
): Promise<void> {
  await pool.query(
    `insert into "user" (id, name, email)
     values ($1, 'Persistence Test', 'persistence-test@example.invalid')
     on conflict (id) do nothing`,
    [event.uploadedByUserId],
  );
  await pool.query(
    `insert into intake_batches (id, created_by_user_id, status, total_files)
     values ($1, $2, 'open', 1)`,
    [event.batchId, event.uploadedByUserId],
  );
  await pool.query(
    `insert into intake_files (
       id, batch_id, uploaded_by_user_id, original_file_name,
       sanitized_file_name, mime_type, size_bytes, storage_bucket,
       storage_key, uploaded_at
     ) values ($1, $2, $3, $4, $4, $5, $6, 'source-bucket', $7, $8)`,
    [
      event.uploadId,
      event.batchId,
      event.uploadedByUserId,
      event.originalFileName,
      event.mimeType,
      event.sizeBytes,
      `${event.uploadId}.pdf`,
      event.uploadedAt,
    ],
  );
  await pool.query(
    `insert into worker_idempotency (
       idempotency_key, job_id, terminal_state, claim_owner,
       lease_expires_at, attempt_number
     ) values ($1, $2, 'running', 'persistence-test-owner', now() + interval '1 hour', 1)`,
    [event.eventId, jobId],
  );
}

function buildSuccessInput(input: {
  event: DocumentIngestEventV1;
  resultBucket: string;
  source: Buffer;
  page: Buffer;
  payorShortName: string;
}): PrepareResultPersistenceInput {
  return {
    event: input.event,
    outcome: "Done",
    payorShortName: input.payorShortName,
    uploadedAt: input.event.uploadedAt,
    build: ({ documentResultId, processedNumber, preparedAt }) => {
      const rawKey = `results/${input.event.uploadId}/raw.json`;
      const finalJsonKey = `results/${input.event.uploadId}/final.json`;
      const pdfKey = `unsigned/${documentResultId}/${processedNumber}.pdf`;
      const artifactKeys = {
        source: `${input.event.uploadId}.pdf`,
        rawResultJson: rawKey,
        finalResultJson: finalJsonKey,
        renamedPdf: pdfKey,
      };
      const payload = { preparedAt, artifactKeys, normalized: { payor: "A" } };
      return {
        documentResult: {
          eventId: input.event.eventId,
          batchId: input.event.batchId,
          uploadId: input.event.uploadId,
          sourceFileId: input.event.sourceFileId,
          revision: input.event.revision,
          outcome: "Done",
          status: "success",
          finalKey: pdfKey,
          originalFileName: input.event.originalFileName,
          sourceHash: checksum(input.source),
          dataFingerprint: null,
          periodEnd: "2026-07-31",
          payeeName: "Payee",
          payeeTin: "111111111",
          payeeShortName: "PAYEE",
          payorName: "Payor",
          payorTin: "222222222",
          payorShortName: input.payorShortName,
          reasonCodes: [],
          payload,
          validation: { status: "valid", reasons: [], checks: [] },
          artifactKey: finalJsonKey,
        },
        certificateMetadata: {
          certificateDocumentType: "BIR2307",
          certificateIssuerShortName: input.payorShortName,
          certificateIssuerShortNameNormalized: input.payorShortName,
          certificateRecipientShortName: "PAYEE",
          certificateSettlementReferenceNumber: null,
          certificateBillingMonthMMYY: "0726",
          certificateDateUploaded: null,
        },
        artifacts: [
          {
            role: "raw_json",
            bucket: input.resultBucket,
            key: rawKey,
            contentType: "application/json",
            body: { kind: "text", text: JSON.stringify({ preparedAt }) },
          },
          {
            role: "final_json",
            bucket: input.resultBucket,
            key: finalJsonKey,
            contentType: "application/json",
            body: { kind: "text", text: JSON.stringify(payload) },
          },
          {
            role: "unsigned_pdf",
            bucket: input.resultBucket,
            key: pdfKey,
            contentType: "application/pdf",
            body: {
              kind: "source_page",
              sourceBucket: "source-bucket",
              sourceKey: `${input.event.uploadId}.pdf`,
              sourcePageNumber: 1,
              sourceSha256: checksum(input.source),
              inlineBody: input.page,
            },
          },
        ],
      };
    },
  };
}

function buildTerminalInput(input: {
  event: DocumentIngestEventV1;
  resultBucket: string;
  outcome: "Error" | "Duplicate";
}): PrepareResultPersistenceInput {
  return {
    event: input.event,
    outcome: input.outcome,
    build: ({ preparedAt }) => {
      const suffix = input.outcome === "Error" ? "error" : "duplicate";
      const artifactKey = `results/${input.event.uploadId}/${suffix}.json`;
      const artifactKeys = {
        source: `${input.event.uploadId}.pdf`,
        finalResultJson: artifactKey,
      };
      const payload = { preparedAt, artifactKeys, status: suffix };
      return {
        documentResult: {
          eventId: input.event.eventId,
          batchId: input.event.batchId,
          uploadId: input.event.uploadId,
          sourceFileId: input.event.sourceFileId,
          revision: input.event.revision,
          outcome: input.outcome,
          status: suffix,
          finalKey: null,
          originalFileName: input.event.originalFileName,
          sourceHash: null,
          dataFingerprint: null,
          periodEnd: null,
          payeeName: null,
          payeeTin: null,
          payeeShortName: null,
          payorName: null,
          payorTin: null,
          payorShortName: null,
          reasonCodes: [suffix],
          payload,
          validation: { status: "invalid", reasons: [suffix], checks: [] },
          artifactKey,
        },
        certificateMetadata: {
          certificateDocumentType: null,
          certificateIssuerShortName: null,
          certificateIssuerShortNameNormalized: null,
          certificateRecipientShortName: null,
          certificateSettlementReferenceNumber: null,
          certificateBillingMonthMMYY: null,
          certificateDateUploaded: null,
        },
        artifacts: [
          {
            role: "final_json",
            bucket: input.resultBucket,
            key: artifactKey,
            contentType: "application/json",
            body: { kind: "text", text: JSON.stringify(payload) },
          },
        ],
      };
    },
  };
}

async function withFixture(
  run: (input: {
    db: DbClient;
    pool: ReturnType<typeof createDbClient>["pool"];
    event: DocumentIngestEventV1;
    jobId: string;
    s3: StatefulFakeS3;
    source: Buffer;
    page: Buffer;
    payorShortName: string;
  }) => Promise<void>,
): Promise<void> {
  assert.ok(databaseUrl);
  const { db, pool } = createDbClient(databaseUrl);
  const event = createEvent({
    eventId: `persistence-${randomUUID()}`,
    batchId: randomUUID(),
    uploadId: randomUUID(),
  });
  const jobId = `job_${randomUUID()}`;
  const payorShortName = `PAYOR-${randomUUID()}`;
  const source = await createPdf();
  const page = (await splitPdfPages(source))[0]?.content;
  assert.ok(page);
  const s3 = new StatefulFakeS3();
  s3.seed("source-bucket", `${event.uploadId}.pdf`, source);
  await seedFixture(pool, event, jobId);

  try {
    await run({ db, pool, event, jobId, s3, source, page, payorShortName });
  } finally {
    await pool.query(
      "delete from worker_idempotency where idempotency_key = $1",
      [event.eventId],
    );
    await pool.query("delete from intake_batches where id = $1", [
      event.batchId,
    ]);
    await pool.query(
      "delete from certificate_processed_number_counters where payor_short_name = $1",
      [payorShortName],
    );
    await pool.query('delete from "user" where id = $1', [
      event.uploadedByUserId,
    ]);
    await pool.end();
  }
}

test(
  "a failed PDF write resumes from the durable source without duplicating artifacts or numbers",
  {
    skip: databaseUrl
      ? false
      : "RESULT_PERSISTENCE_TEST_DATABASE_URL is not set",
  },
  async () => {
    await withFixture(
      async ({ db, pool, event, jobId, s3, source, page, payorShortName }) => {
        const input = buildSuccessInput({
          event,
          resultBucket: "result-bucket",
          source,
          page,
          payorShortName,
        });
        const service = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
          random: () => 0,
        });

        s3.failNextPdfPut();
        await assert.rejects(service.persistPreparedResult(input, jobId));

        const operation = await pool.query<{
          id: string;
          state: string;
          reserved_document_result_id: number;
        }>(
          `select id, state, reserved_document_result_id
         from result_persistence_operations where event_id = $1`,
          [event.eventId],
        );
        assert.equal(operation.rows[0]?.state, "retryable_error");
        const reservedId = operation.rows[0]?.reserved_document_result_id;
        assert.ok(reservedId);
        const actualPdfKey = `unsigned/${reservedId}/1.pdf`;

        const resumed = await service.resumeExisting(event.eventId, jobId);
        assert.equal(resumed?.outcome, "Done");
        assert.equal(
          s3.body("result-bucket", actualPdfKey)?.equals(page),
          true,
        );
        assert.equal(s3.putCount("result-bucket", actualPdfKey), 1);

        const counts = await pool.query<{
          result_count: number;
          counter_value: number;
          verified_count: number;
        }>(
          `select
           (select count(*)::int from document_results where upload_id = $1) as result_count,
           (select last_value from certificate_processed_number_counters where payor_short_name = $2) as counter_value,
           (select count(*)::int from result_persistence_artifacts where operation_id = $3 and state = 'verified') as verified_count`,
          [event.uploadId, payorShortName, operation.rows[0]?.id],
        );
        assert.equal(counts.rows[0]?.result_count, 1);
        assert.equal(counts.rows[0]?.counter_value, 1);
        assert.equal(counts.rows[0]?.verified_count, 3);

        await service.resumeExisting(event.eventId, jobId);
        assert.equal(s3.putCount("result-bucket", actualPdfKey), 1);
      },
    );
  },
);

for (const outcome of ["Error", "Duplicate"] as const) {
  test(
    `${outcome} finalization persists only its terminal JSON artifact`,
    {
      skip: databaseUrl
        ? false
        : "RESULT_PERSISTENCE_TEST_DATABASE_URL is not set",
    },
    async () => {
      await withFixture(async ({ db, pool, event, jobId, s3 }) => {
        const service = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
        });
        const resumed = await service.persistPreparedResult(
          buildTerminalInput({ event, resultBucket: "result-bucket", outcome }),
          jobId,
        );
        assert.equal(resumed.outcome, outcome);
        assert.equal(resumed.artifactKeys.rawResultJson, undefined);
        assert.equal(resumed.artifactKeys.renamedPdf, undefined);

        const result = await pool.query<{
          final_key: string | null;
          artifact_key: string;
          artifact_keys: Record<string, string>;
          artifact_count: number;
        }>(
          `select final_key, artifact_key, payload->'artifactKeys' as artifact_keys,
             (select count(*)::int from result_persistence_artifacts where operation_id =
               (select id from result_persistence_operations where event_id = $1)) as artifact_count
           from document_results where upload_id = $2`,
          [event.eventId, event.uploadId],
        );
        assert.equal(result.rows[0]?.final_key, null);
        assert.equal(
          result.rows[0]?.artifact_key,
          result.rows[0]?.artifact_keys.finalResultJson,
        );
        assert.equal(result.rows[0]?.artifact_keys.rawResultJson, undefined);
        assert.equal(result.rows[0]?.artifact_count, 1);
      });
    },
  );
}

test(
  "a conflicting destination blocks the intent instead of overwriting S3",
  {
    skip: databaseUrl
      ? false
      : "RESULT_PERSISTENCE_TEST_DATABASE_URL is not set",
  },
  async () => {
    await withFixture(
      async ({ db, pool, event, jobId, s3, source, page, payorShortName }) => {
        const finalKey = `results/${event.uploadId}/final.json`;
        s3.seed("result-bucket", finalKey, Buffer.from("different"));
        const service = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
        });

        await assert.rejects(
          service.persistPreparedResult(
            buildSuccessInput({
              event,
              resultBucket: "result-bucket",
              source,
              page,
              payorShortName,
            }),
            jobId,
          ),
          PersistenceBlockedError,
        );
        const state = await pool.query<{ state: string; results: number }>(
          `select state,
           (select count(*)::int from document_results where upload_id = $1) as results
         from result_persistence_operations where event_id = $2`,
          [event.uploadId, event.eventId],
        );
        assert.equal(state.rows[0]?.state, "blocked");
        assert.equal(state.rows[0]?.results, 0);
        assert.equal(
          s3.body("result-bucket", finalKey)?.toString(),
          "different",
        );
      },
    );
  },
);

test(
  "a lost artifact-marker response reuses the matching S3 object",
  {
    skip: databaseUrl
      ? false
      : "RESULT_PERSISTENCE_TEST_DATABASE_URL is not set",
  },
  async () => {
    await withFixture(
      async ({ db, event, jobId, s3, source, page, payorShortName }) => {
        let injectFailure = true;
        const input = buildSuccessInput({
          event,
          resultBucket: "result-bucket",
          source,
          page,
          payorShortName,
        });
        const rawKey = `results/${event.uploadId}/raw.json`;
        const failingService = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
          afterArtifactWrite: () => {
            if (injectFailure) {
              injectFailure = false;
              throw new Error("injected artifact marker response loss");
            }
          },
        });
        await assert.rejects(
          failingService.persistPreparedResult(input, jobId),
          /marker response loss/u,
        );
        assert.equal(s3.putCount("result-bucket", rawKey), 1);

        const normalService = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
        });
        assert.equal(
          (await normalService.resumeExisting(event.eventId, jobId))?.outcome,
          "Done",
        );
        assert.equal(s3.putCount("result-bucket", rawKey), 1);
      },
    );
  },
);

test(
  "invalid durable intent data is blocked instead of retried",
  {
    skip: databaseUrl
      ? false
      : "RESULT_PERSISTENCE_TEST_DATABASE_URL is not set",
  },
  async () => {
    await withFixture(
      async ({ db, pool, event, jobId, s3, source, page, payorShortName }) => {
        const service = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
        });
        const finalKey = `results/${event.uploadId}/final.json`;
        s3.failNextPut("result-bucket", finalKey);
        await assert.rejects(
          service.persistPreparedResult(
            buildSuccessInput({
              event,
              resultBucket: "result-bucket",
              source,
              page,
              payorShortName,
            }),
            jobId,
          ),
        );
        await pool.query(
          `update result_persistence_operations
         set document_result = jsonb_set(document_result, '{artifactKey}', '"wrong.json"')
         where event_id = $1`,
          [event.eventId],
        );

        await assert.rejects(
          service.resumeExisting(event.eventId, jobId),
          PersistenceBlockedError,
        );
        const state = await pool.query<{ state: string }>(
          "select state from result_persistence_operations where event_id = $1",
          [event.eventId],
        );
        assert.equal(state.rows[0]?.state, "blocked");
      },
    );
  },
);

test(
  "a stale worker cannot finalize after claim ownership changes",
  {
    skip: databaseUrl
      ? false
      : "RESULT_PERSISTENCE_TEST_DATABASE_URL is not set",
  },
  async () => {
    await withFixture(
      async ({ db, pool, event, jobId, s3, source, page, payorShortName }) => {
        const service = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
        });
        const input = buildSuccessInput({
          event,
          resultBucket: "result-bucket",
          source,
          page,
          payorShortName,
        });
        const finalKey = `results/${event.uploadId}/final.json`;
        s3.failNextPut("result-bucket", finalKey);
        await assert.rejects(service.persistPreparedResult(input, jobId));

        const replacementJobId = `job_${randomUUID()}`;
        await pool.query(
          `update worker_idempotency
         set job_id = $1, claim_owner = 'replacement', lease_expires_at = now() + interval '1 hour'
         where idempotency_key = $2`,
          [replacementJobId, event.eventId],
        );

        await assert.rejects(
          service.resumeExisting(event.eventId, jobId),
          PersistenceOwnershipLostError,
        );
        assert.equal(
          Number(
            (
              await pool.query(
                "select count(*)::int as count from document_results where upload_id = $1",
                [event.uploadId],
              )
            ).rows[0]?.count,
          ),
          0,
        );
        const resumed = await service.resumeExisting(
          event.eventId,
          replacementJobId,
        );
        assert.equal(resumed?.outcome, "Done");
      },
    );
  },
);

test(
  "two concurrent resumptions create one result and one set of objects",
  {
    skip: databaseUrl
      ? false
      : "RESULT_PERSISTENCE_TEST_DATABASE_URL is not set",
  },
  async () => {
    await withFixture(
      async ({ db, pool, event, jobId, s3, source, page, payorShortName }) => {
        const service = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
        });
        const input = buildSuccessInput({
          event,
          resultBucket: "result-bucket",
          source,
          page,
          payorShortName,
        });
        const finalKey = `results/${event.uploadId}/final.json`;
        s3.failNextPut("result-bucket", finalKey);
        await assert.rejects(service.persistPreparedResult(input, jobId));

        const [first, second] = await Promise.all([
          service.resumeExisting(event.eventId, jobId),
          service.resumeExisting(event.eventId, jobId),
        ]);
        assert.equal(first?.outcome, "Done");
        assert.equal(second?.outcome, "Done");

        const counts = await pool.query<{
          result_count: number;
          counter_value: number;
        }>(
          `select
           (select count(*)::int from document_results where upload_id = $1) as result_count,
           (select last_value from certificate_processed_number_counters where payor_short_name = $2) as counter_value`,
          [event.uploadId, payorShortName],
        );
        assert.equal(counts.rows[0]?.result_count, 1);
        assert.equal(counts.rows[0]?.counter_value, 1);
        assert.equal(s3.putCount("result-bucket", finalKey), 1);
      },
    );
  },
);

test(
  "a lost finalization response stays completed and resumes idempotently",
  {
    skip: databaseUrl
      ? false
      : "RESULT_PERSISTENCE_TEST_DATABASE_URL is not set",
  },
  async () => {
    await withFixture(
      async ({ db, pool, event, jobId, s3, source, page, payorShortName }) => {
        let transactionCount = 0;
        const lossyDb = new Proxy(db, {
          get(target, property, receiver) {
            if (property !== "transaction") {
              const value = Reflect.get(target, property, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return async (...args: Parameters<DbClient["transaction"]>) => {
              transactionCount += 1;
              const result = await db.transaction(...args);
              if (transactionCount === 2) {
                throw new Error("injected finalization response loss");
              }
              return result;
            };
          },
        }) as DbClient;
        const lossyService = createResultPersistenceService({
          db: lossyDb,
          s3: s3.client,
          logger,
        });
        await assert.rejects(
          lossyService.persistPreparedResult(
            buildSuccessInput({
              event,
              resultBucket: "result-bucket",
              source,
              page,
              payorShortName,
            }),
            jobId,
          ),
          /response loss/u,
        );

        const state = await pool.query<{ state: string; results: number }>(
          `select state,
           (select count(*)::int from document_results where upload_id = $1) as results
         from result_persistence_operations where event_id = $2`,
          [event.uploadId, event.eventId],
        );
        assert.equal(state.rows[0]?.state, "completed");
        assert.equal(state.rows[0]?.results, 1);

        const normalService = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
        });
        assert.equal(
          (await normalService.resumeExisting(event.eventId, jobId))?.outcome,
          "Done",
        );
      },
    );
  },
);

test(
  "retry backoff remains retryable and is capped at fifteen minutes",
  {
    skip: databaseUrl
      ? false
      : "RESULT_PERSISTENCE_TEST_DATABASE_URL is not set",
  },
  async () => {
    await withFixture(
      async ({ db, pool, event, jobId, s3, source, page, payorShortName }) => {
        const finalKey = `results/${event.uploadId}/final.json`;
        const fixedNow = new Date("2026-07-13T00:00:00.000Z");
        const service = createResultPersistenceService({
          db,
          s3: s3.client,
          logger,
          now: () => fixedNow,
          random: () => 1,
        });
        const input = buildSuccessInput({
          event,
          resultBucket: "result-bucket",
          source,
          page,
          payorShortName,
        });
        s3.failNextPut("result-bucket", finalKey);
        await assert.rejects(service.persistPreparedResult(input, jobId));
        await pool.query(
          "update result_persistence_operations set attempt_count = 20 where event_id = $1",
          [event.eventId],
        );
        s3.failNextPut("result-bucket", finalKey);
        await assert.rejects(service.resumeExisting(event.eventId, jobId));

        const retry = await pool.query<{
          state: string;
          attempt_count: number;
          next_attempt_at: Date;
        }>(
          `select state, attempt_count, next_attempt_at
         from result_persistence_operations where event_id = $1`,
          [event.eventId],
        );
        assert.equal(retry.rows[0]?.state, "retryable_error");
        assert.equal(retry.rows[0]?.attempt_count, 21);
        assert.equal(
          retry.rows[0]?.next_attempt_at.getTime() - fixedNow.getTime(),
          15 * 60_000,
        );
      },
    );
  },
);
