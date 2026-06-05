import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { createExtractDocumentNode } from "./extractDocument.ts";
import type { WorkflowState } from "../types.ts";
import type { Bir2307ZoneId } from "../utils/zoneOcr.ts";

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

function buildNodeWithZoneFallback(options: {
  mainText: string;
  zoneTextById: Partial<Record<Bir2307ZoneId, string>>;
  failingZoneId?: Bir2307ZoneId;
  calls: Array<{ revision: string; mimeType: string; content: string }>;
}) {
  return createExtractDocumentNode({
    logger: logger as never,
    zoneOcrConfig: {
      enabled: true,
      maxZonesPerPage: 4,
      singlePageRescueEnabled: true,
    },
    zoneRenderer: {
      async render(input) {
        if (input.zone.id === options.failingZoneId) {
          throw new Error("zone render failed");
        }

        return {
          content: Buffer.from(`png:${input.zone.id}`),
          mimeType: "image/png",
          metadata: {
            zoneId: input.zone.id,
            renderDpi: 300,
            renderMimeType: "image/png",
            renderElapsedMs: 1,
            originalPdfBytes: input.content.byteLength,
            renderedPngBytes: Buffer.byteLength(`png:${input.zone.id}`),
            cropPixels: { x: 0, y: 0, width: 10, height: 10 },
            pagePixels: { width: 100, height: 100 },
            renderer: "pdftoppm",
          },
        };
      },
    },
    ocrClient: {
      async extract(input) {
        options.calls.push({
          revision: input.revision,
          mimeType: input.mimeType,
          content: input.content.toString(),
        });
        const zoneId = input.revision.match(/zone-([a-z_]+)$/u)?.[1] as
          | Bir2307ZoneId
          | undefined;
        const parsedText = zoneId
          ? (options.zoneTextById[zoneId] ?? "")
          : options.mainText;

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

test("extractDocument defers multiple certificate page errors until after normalization", async () => {
  const extractDocument = buildNode([certificateText, memoText, certificateText]);
  const result = await extractDocument(await buildState(3));

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.decision?.terminalStatus, "Done");
  assert.equal(result.decision?.phase, "normalize");
  assert.deepEqual(result.decision?.reasonCodes, [
    "multiple_certificate_pages_detected",
  ]);
  assert.equal(result.extraction?.parsedText, certificateText);
  assert.deepEqual(result.batchSummary?.certificatePageNumbers, [1, 3]);
  assert.deepEqual(result.batchSummary?.ignoredPageNumbers, [2]);
  assert.deepEqual(result.batchSummary?.failedPageNumbers, [1, 3]);
  assert.equal(
    result.validation?.checks[0]?.code,
    "MULTIPLE_CERTIFICATE_PAGES_DETECTED",
  );
});

test("extractDocument runs zone OCR fallback for missing certificate zones", async () => {
  const calls: Array<{ revision: string; mimeType: string; content: string }> =
    [];
  const extractDocument = buildNodeWithZoneFallback({
    calls,
    mainText: certificateText,
    zoneTextById: {
      header_period: "For the Period From 01/01/2024 To 03/31/2024",
      payee_payor_info:
        "Part I Payee Information TIN 267-090-070 Part II Payor Information TIN 266-567-164",
      tax_table: "ATC WC160 Amount of income payments 289.93 Tax Withheld PHP 5.80",
      signature_block:
        "VICTOR F. RADA Finance Manager TIN 942-107-070 Signature over Printed Name",
    },
  });

  const result = await extractDocument(await buildState(1));
  const extraction = result.extraction;
  const metadata = extraction?.metadata.zoneOcrFallback as
    | Record<string, unknown>
    | undefined;

  assert.equal(result.decision?.route, "continue");
  assert.equal(calls[0]?.mimeType, "application/pdf");
  assert.equal(calls.filter((call) => call.mimeType === "image/png").length, 4);
  assert.ok(
    extraction?.parsedText?.includes(
      "[Zone OCR fallback: signature_block]\nVICTOR F. RADA",
    ),
  );
  assert.equal(metadata?.status, "completed");
  assert.equal(metadata?.appended, true);
  assert.equal(
    (extraction?.raw.zoneOcrFallbackText as Array<Record<string, unknown>>)
      .some((block) => typeof block.markdown === "string"),
    true,
  );
  assert.deepEqual(metadata?.triggeredZones, [
    "header_period",
    "payee_payor_info",
    "tax_table",
    "signature_block",
  ]);
  assert.equal(
    Buffer.from(result.pages?.[0]?.sourceContentBase64 ?? "", "base64").subarray(0, 4).toString(),
    "%PDF",
  );
});

test("extractDocument keeps original OCR result when a zone fallback fails", async () => {
  const calls: Array<{ revision: string; mimeType: string; content: string }> =
    [];
  const extractDocument = buildNodeWithZoneFallback({
    calls,
    mainText: certificateText,
    failingZoneId: "signature_block",
    zoneTextById: {
      header_period: "For the Period From 01/01/2024 To 03/31/2024",
    },
  });

  const result = await extractDocument(await buildState(1));
  const metadata = result.extraction?.metadata.zoneOcrFallback as
    | Record<string, unknown>
    | undefined;
  const failures = metadata?.failures as Array<Record<string, unknown>>;

  assert.equal(result.decision?.route, "continue");
  assert.equal(calls[0]?.mimeType, "application/pdf");
  assert.ok((calls.length ?? 0) > 1);
  assert.equal(failures.some((failure) => failure.zoneId === "signature_block"), true);
  assert.ok(result.extraction?.parsedText?.includes("[Zone OCR fallback: header_period]"));
});
