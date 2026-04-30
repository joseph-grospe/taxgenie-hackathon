import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { createExtractDocumentNode } from "./extractDocument.ts";
import type { WorkflowState } from "../types.ts";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const certificateText = `
  Republic of the Philippines
  Department of Finance
  Bureau of Internal Revenue
  BIR Form No. 2307
  Certificate of Creditable Tax Withheld at Source
`;

const memoText = "Cover sheet memo with supporting schedules.";

async function buildPdf(pageCount: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([200, 200]);
  }

  return Buffer.from(await document.save());
}

function buildState(pageCount: number): Promise<WorkflowState> {
  return buildPdf(pageCount).then((pdf) => ({
    event: {
      eventId: "event-1",
      batchId: "11111111-1111-1111-1111-111111111111",
      uploadId: "22222222-2222-2222-2222-222222222222",
      sourceFileId: "source-1",
      revision: "v1",
      originalFileName: "certificate.pdf",
    },
    jobId: "job-1",
    source: {
      uri: "s3://source/certificate.pdf",
      bucket: "source",
      key: "certificate.pdf",
      mimeType: "application/pdf",
    },
    sourceContentBase64: pdf.toString("base64"),
  }) as WorkflowState);
}

function buildNode(textByPage: string[]) {
  return createExtractDocumentNode({
    logger: logger as never,
    ocrClient: {
      async extract(input) {
        const pageNumber = Number(input.revision.match(/page-(\d+)$/u)?.[1]);
        const parsedText = textByPage[pageNumber - 1] ?? "";

        return {
          provider: "test",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
          raw: { text: parsedText },
          parsedText,
          metadata: {},
        };
      },
    },
  });
}

test("extractDocument continues for one certificate page and ignores non-certificate pages", async () => {
  const extractDocument = buildNode([memoText, certificateText, memoText]);
  const result = await extractDocument(await buildState(3));

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.extraction?.parsedText, certificateText);
  assert.deepEqual(result.batchSummary?.certificatePageNumbers, [2]);
  assert.deepEqual(result.batchSummary?.ignoredPageNumbers, [1, 3]);
});

test("extractDocument errors when no certificate pages are detected", async () => {
  const extractDocument = buildNode([memoText, memoText]);
  const result = await extractDocument(await buildState(2));

  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "no_certificate_pages_detected",
  ]);
});

test("extractDocument errors when multiple certificate pages are detected", async () => {
  const extractDocument = buildNode([certificateText, memoText, certificateText]);
  const result = await extractDocument(await buildState(3));

  assert.equal(result.decision?.route, "error");
  assert.equal(result.decision?.terminalStatus, "Error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "multiple_certificate_pages_detected",
  ]);
  assert.deepEqual(result.batchSummary?.certificatePageNumbers, [1, 3]);
  assert.deepEqual(result.batchSummary?.ignoredPageNumbers, [2]);
  assert.deepEqual(result.batchSummary?.failedPageNumbers, [1, 3]);
  assert.equal(
    result.validation?.checks[0]?.code,
    "MULTIPLE_CERTIFICATE_PAGES_DETECTED",
  );
});
