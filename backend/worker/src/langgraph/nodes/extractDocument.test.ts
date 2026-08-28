import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { createExtractDocumentNode } from "./extractDocument.ts";
import type {
  DocumentExtractionClient,
  DocumentExtractionMetadata,
  DocumentExtractionResponse,
} from "../services/documentExtractionClient.ts";
import type { DocumentExtractionResultV3 } from "../services/extractionContract.ts";
import { GeminiExtractionError } from "../services/geminiClient.ts";
import type { PdfRegionRenderer } from "../utils/pdfRegionRenderer.ts";
import type { WorkflowState } from "../types.ts";
import type {
  PdfBlankPageDetectionResult,
  PdfBlankPageDetector,
} from "../utils/pdfBlankPageDetector.ts";
import type { PdfTextLayerExtractor } from "../utils/pdfTextLayerExtractor.ts";
import type {
  SignatureVisualDetectionResult,
  SignatureVisualDetector,
} from "../utils/signatureVisualDetector.ts";
import { withFieldConfidence } from "../testFixtures/fieldConfidence.ts";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

async function buildPdf(pageCount: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([200, 200]);
  }
  return Buffer.from(await document.save());
}

async function buildState(pageCount: number): Promise<WorkflowState> {
  const pdf = await buildPdf(pageCount);
  return {
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
      hash: "a".repeat(64),
    },
    sourceContentBase64: pdf.toString("base64"),
  };
}

function buildCertificate(
  certificateKey: string,
  pageNumbers: number[],
  overrides: Partial<DocumentExtractionResultV3["certificates"][number]> = {},
): DocumentExtractionResultV3["certificates"][number] {
  const pageNumber = pageNumbers.at(-1) ?? 1;
  return withFieldConfidence({
    certificateKey,
    pageNumbers,
    period: {
      start: "2026-04-01",
      end: "2026-06-30",
      monthOfQuarter: "first",
    },
    payee: {
      name: `PAYEE ${certificateKey}`,
      tin: "00503166300000",
      address: null,
      zip: null,
    },
    payor: {
      name: `PAYOR ${certificateKey}`,
      tin: "0002025240000",
      address: null,
      zip: null,
    },
    taxRows: [
      {
        lineNumber: 1,
        pageNumber,
        atcCode: "WC160",
        description: null,
        monthlyAmounts: {
          first: "100.00",
          second: null,
          third: null,
        },
        taxBase: "100.00",
        taxRate: "0.020000",
        taxWithheld: "2.00",
      },
    ],
    primaryAtcCode: "WC160",
    totals: { taxBase: "100.00", taxWithheld: "2.00" },
    signer: {
      printedName: "SIGNER NAME",
      title: "Manager",
      tin: "901327847000",
      companyName: null,
      signature: {
        present: true,
        confidence: 0.93,
        pageNumber,
        source: "gemini",
      },
    },
    confidence: {
      period: 0.99,
      payee: 0.98,
      payor: 0.98,
      taxRows: 0.96,
      signer: 0.91,
    },
    evidence: {},
    warnings: [],
    ...overrides,
  });
}

const metadata: DocumentExtractionMetadata = {
  provider: "gemini",
  requestedModel: "gemini-3-flash-preview",
  responseModel: "gemini-3-flash-preview-20260701",
  promptVersion: "bir2307-agentic-v10-identity-visibility",
  schemaVersion: 3,
  thinkingLevel: "high",
  mediaResolution: "medium",
  startedAt: "2026-07-27T00:00:00.000Z",
  finishedAt: "2026-07-27T00:00:01.000Z",
  latencyMs: 1_000,
  attemptCount: 1,
  usage: { promptTokenCount: 100, totalTokenCount: 200 },
};

function response(
  pageCount: number,
  certificates: DocumentExtractionResultV3["certificates"],
  documentType: DocumentExtractionResultV3["classification"]["documentType"] = "BIR_2307",
): DocumentExtractionResponse {
  return {
    result: {
      schemaVersion: 3,
      classification: { documentType, confidence: 0.99, pageCount },
      certificates,
    },
    metadata,
  };
}

function visualResult(
  confidence: number,
  signerBand = true,
  signaturePresent = true,
): SignatureVisualDetectionResult {
  return {
    status: signaturePresent ? "detected" : "not_detected",
    signaturePresent,
    confidence,
    signerRecoveryEligible: true,
    structure: {
      payorSignerBandVisible: signerBand,
      structuredWindowCount: signerBand ? 1 : 0,
      analysisWindowCount: signerBand ? 1 : 0,
      payorSignerWindow: signerBand
        ? {
            normalized: {
              left: 0.05,
              top: 0.55,
              width: 0.9,
              height: 0.35,
            },
            pixels: { x: 10, y: 110, width: 180, height: 70 },
          }
        : undefined,
    },
    metrics: {
      darkPixelCount: signaturePresent ? 100 : 0,
      candidateCount: signaturePresent ? 1 : 0,
      largestCandidateArea: signaturePresent ? 100 : 0,
      largestCandidateWidth: signaturePresent ? 50 : 0,
      largestCandidateHeight: signaturePresent ? 20 : 0,
      analysisWidth: 180,
      analysisHeight: 70,
    },
    render: {
      dpi: 400,
      elapsedMs: 10,
      cropPixels: { x: 10, y: 110, width: 180, height: 70 },
      pagePixels: { width: 200, height: 200 },
      originalPagePixels: { width: 200, height: 200 },
      rotationApplied: "none",
    },
  };
}

function blankPageDetector(
  blank: boolean,
  calls: number[] = [],
): PdfBlankPageDetector {
  return {
    detect: async (input): Promise<PdfBlankPageDetectionResult> => {
      calls.push(input.pageNumber);
      return {
        blank,
        width: 200,
        height: 200,
        nonWhitePixelCount: blank ? 0 : 1,
        dpi: 72,
        elapsedMs: 1,
      };
    },
  };
}

function positionedSignerText(
  values: {
    printedName?: string;
    title?: string;
    tin?: string;
    companyName?: string;
  } = {},
): PdfTextLayerExtractor {
  const lines = [
    values.printedName ?? "SIGNER NAME",
    values.title ?? "Manager",
    values.tin ?? "901-327-847-000",
    ...(values.companyName ? [values.companyName] : []),
  ].map((text, index) => ({
    text,
    bounds: {
      left: 20,
      top: 120 + index * 12,
      right: 180,
      bottom: 128 + index * 12,
    },
  }));
  return {
    extract: async () => ({
      text: lines.map((line) => line.text).join("\n"),
      page: { width: 200, height: 200 },
      lines,
      metadata: {
        extractor: "pdftotext",
        layout: true,
        positioned: true,
        elapsedMs: 5,
        originalPdfBytes: 100,
        textLength: lines.reduce((total, line) => total + line.text.length, 0),
      },
    }),
  };
}

const cropRenderer: PdfRegionRenderer = {
  render: async (input) => ({
    content: Buffer.from("payor-signer-crop"),
    mimeType: "image/png",
    metadata: {
      renderer: "pdftoppm",
      dpi: input.dpi,
      elapsedMs: 1,
      renderedBytes: 17,
      bounds: input.bounds,
    },
  }),
};

function withPayorCrop(
  client: DocumentExtractionClient,
  result: {
    printedName: string | null;
    title: string | null;
    tin: string | null;
    companyName: string | null;
  },
): DocumentExtractionClient {
  return {
    ...client,
    extractPayorSigner: async () => ({
      result: { ...result, confidence: 0.95, warnings: [] },
      metadata,
    }),
  };
}

test("extractDocument converts impossible source dates into certificate validation reasons", async () => {
  const state = await buildState(1);
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(1, [
          buildCertificate("invalid-date", [1], {
            period: {
              start: "2026-04-01",
              end: "2026-06-31",
              monthOfQuarter: "first",
            },
          }),
        ]),
    },
    signatureVisualMinConfidence: 0.86,
    logger,
  });

  const result = await node(state);
  assert.equal(result.certificates?.length, 1);
  assert.equal(
    result.extractionResult?.certificates[0]?.period.end,
    "2026-06-31",
  );
  assert.equal(result.certificates?.[0]?.effective.period.end, null);
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes("invalid_period_end_date"),
  );
  assert.equal(
    result.reasonCodes?.includes("gemini_schema_validation_failed"),
    false,
  );
});

test("extractDocument deterministically derives incomplete two-section totals", async () => {
  for (const [firstTaxBase, secondTaxBase, expectedTaxBase] of [
    ["10725.55", "10725.55", "21451.10"],
    ["1066.55", "1066.55", "2133.10"],
  ] as const) {
    const state = await buildState(1);
    const base = buildCertificate("two-section", [1]);
    const node = createExtractDocumentNode({
      extractionClient: {
        extract: async () =>
          response(1, [
            {
              ...base,
              taxRows: [
                {
                  ...base.taxRows[0]!,
                  lineNumber: 1,
                  taxBase: firstTaxBase,
                  taxWithheld: "10.00",
                },
                {
                  ...base.taxRows[0]!,
                  lineNumber: 2,
                  taxBase: secondTaxBase,
                  taxWithheld: null,
                },
              ],
              totals: { taxBase: firstTaxBase, taxWithheld: "10.00" },
            },
          ]),
      },
      signatureVisualMinConfidence: 0.86,
      logger,
    });

    const result = await node(state);
    assert.equal(result.certificates?.length, 1);
    assert.deepEqual(result.certificates?.[0]?.effective.totals, {
      taxBase: expectedTaxBase,
      taxWithheld: null,
    });
  }
});

test("extractDocument keeps only the lowest-page certificate from a multi-certificate response", async () => {
  const state = await buildState(3);
  let requestCount = 0;
  let sentBytes: Buffer | undefined;
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async (request) => {
        requestCount += 1;
        sentBytes = request.content;
        return response(3, [
          buildCertificate("discarded-page-2", [2]),
          buildCertificate("selected-page-1", [1], {
            period: {
              start: "2026-04-01",
              end: "2026-06-30",
              monthOfQuarter: null,
            },
          }),
          buildCertificate("discarded-page-3", [3]),
        ]);
      },
    },
    signatureVisualMinConfidence: 0.86,
    logger,
  });

  const result = await node(state);
  assert.equal(requestCount, 1);
  assert.deepEqual(
    sentBytes,
    Buffer.from(state.sourceContentBase64!, "base64"),
  );
  assert.equal(result.certificates?.length, 1);
  assert.deepEqual(result.certificates?.[0]?.effective.pageNumbers, [1]);
  assert.equal(
    result.certificates?.[0]?.effective.period.monthOfQuarter,
    "first",
  );
  assert.equal(result.certificates?.[0]?.ordinal, 1);
  assert.equal(result.certificates?.[0]?.status, "error");
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes(
      "multiple_certificates_detected",
    ),
  );
  assert.equal(result.certificates?.[0]?.certificatePdfBase64, undefined);
  assert.deepEqual(result.extractionResult?.certificates, [
    result.extractionResult?.certificates[0],
  ]);
  assert.equal(
    result.extractionResult?.certificates[0]?.certificateKey,
    "selected-page-1",
  );
  assert.deepEqual(result.certificateSelection, {
    strategy: "lowest_page_then_response_order",
    detectedCount: 3,
    selectedResponseOrdinal: 2,
    selectedLowestPageNumber: 1,
    discardedCertificates: [
      { responseOrdinal: 1, pageNumbers: [2] },
      { responseOrdinal: 3, pageNumbers: [3] },
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(result.extractionResult),
    /discarded-page-[23]/u,
  );
  assert.equal(result.sourceContentBase64, undefined);
  assert.equal(result.documentStatus, "error");
  assert.equal(result.decision?.terminalStatus, "Error");
  assert.equal(result.decision?.route, "continue");
});

test("multi-certificate selection uses response order to break lowest-page ties", async () => {
  const state = await buildState(3);
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(3, [
          buildCertificate("first-response", [1, 2]),
          buildCertificate("second-response", [1]),
          buildCertificate("later-page", [3]),
        ]),
    },
    signatureVisualMinConfidence: 0.86,
    logger,
  });

  const result = await node(state);

  assert.equal(
    result.extractionResult?.certificates[0]?.certificateKey,
    "first-response",
  );
  assert.equal(result.certificateSelection?.selectedResponseOrdinal, 1);
});

test("full-response page validation is retained only for the selected certificate", async () => {
  const state = await buildState(3);
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(3, [
          buildCertificate("certificate-1", [1, 2]),
          buildCertificate("certificate-2", [2]),
          buildCertificate("certificate-3", [3]),
        ]),
    },
    signatureVisualMinConfidence: 0.86,
    logger,
  });

  const result = await node(state);
  assert.equal(result.certificates?.[0]?.status, "error");
  assert.equal(result.certificates?.length, 1);
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes(
      "overlapping_certificate_pages",
    ),
  );
  assert.ok(
    result.certificates?.[0]?.reasonCodes.includes(
      "multiple_certificates_detected",
    ),
  );
  assert.deepEqual(result.extractionPageIssues, [
    {
      certificateOrdinal: 1,
      code: "overlapping_certificate_pages",
    },
  ]);
  assert.equal(result.documentStatus, "error");
});

test("an unassigned blank page explains an exact page-count deficit", async () => {
  const state = await buildState(2);
  const detectorCalls: number[] = [];
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(1, [buildCertificate("certificate-1", [1])]),
    },
    pdfBlankPageDetector: blankPageDetector(true, detectorCalls),
    signatureVisualDetector: {
      detect: async () => visualResult(0.9),
    },
    signatureVisualMinConfidence: 0.86,
    pdfTextLayerExtractor: positionedSignerText(),
    pdfRegionRenderer: cropRenderer,
    logger,
  });

  const result = await node(state);

  assert.deepEqual(detectorCalls, [2]);
  assert.deepEqual(result.ignoredBlankPageNumbers, [2]);
  assert.deepEqual(result.pageWarnings, []);
  assert.deepEqual(result.extractionPageIssues, []);
  assert.equal(result.pageCount, 2);
  assert.equal(result.extractionResult?.classification.pageCount, 1);
  assert.equal(result.certificates?.[0]?.status, "accepted");
  assert.equal(result.documentStatus, "accepted");
});

test("a nonblank unassigned page retains the page-count mismatch", async () => {
  const state = await buildState(2);
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(1, [buildCertificate("certificate-1", [1])]),
    },
    pdfBlankPageDetector: blankPageDetector(false),
    signatureVisualDetector: {
      detect: async () => visualResult(0.9),
    },
    signatureVisualMinConfidence: 0.86,
    pdfTextLayerExtractor: positionedSignerText(),
    pdfRegionRenderer: cropRenderer,
    logger,
  });

  const result = await node(state);

  assert.deepEqual(result.ignoredBlankPageNumbers, []);
  assert.deepEqual(result.pageWarnings, [
    { code: "unassigned_nonblank_page", pageNumber: 2 },
  ]);
  assert.ok(
    result.extractionPageIssues?.some(
      (issue) => issue.code === "page_count_mismatch",
    ),
  );
  assert.equal(result.certificates?.[0]?.status, "error");
  assert.equal(result.documentStatus, "error");
});

test("an unassigned nonblank page is a nonblocking warning when the physical count is correct", async () => {
  const state = await buildState(2);
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(2, [buildCertificate("certificate-1", [1])]),
    },
    pdfBlankPageDetector: blankPageDetector(false),
    signatureVisualDetector: {
      detect: async () => visualResult(0.9),
    },
    signatureVisualMinConfidence: 0.86,
    pdfTextLayerExtractor: positionedSignerText(),
    pdfRegionRenderer: cropRenderer,
    logger,
  });

  const result = await node(state);

  assert.deepEqual(result.extractionPageIssues, []);
  assert.deepEqual(result.pageWarnings, [
    { code: "unassigned_nonblank_page", pageNumber: 2 },
  ]);
  assert.equal(result.certificates?.[0]?.status, "accepted");
  assert.equal(result.documentStatus, "accepted");
  assert.deepEqual(result.reasonCodes, []);
});

test("a blank page referenced by a certificate cannot explain a deficit", async () => {
  const state = await buildState(2);
  const detectorCalls: number[] = [];
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(1, [buildCertificate("certificate-1", [1, 2])]),
    },
    pdfBlankPageDetector: blankPageDetector(true, detectorCalls),
    signatureVisualMinConfidence: 0.86,
    logger,
  });

  const result = await node(state);

  assert.deepEqual(detectorCalls, []);
  assert.deepEqual(result.ignoredBlankPageNumbers, []);
  assert.deepEqual(result.pageWarnings, []);
  assert.ok(
    result.extractionPageIssues?.some(
      (issue) => issue.code === "page_count_mismatch",
    ),
  );
  assert.equal(result.documentStatus, "error");
});

test("blank-page detector failures retain the page-count mismatch", async () => {
  const state = await buildState(2);
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(1, [buildCertificate("certificate-1", [1])]),
    },
    pdfBlankPageDetector: {
      detect: async () => {
        throw new Error("renderer unavailable");
      },
    },
    signatureVisualMinConfidence: 0.86,
    logger,
  });

  const result = await node(state);

  assert.deepEqual(result.ignoredBlankPageNumbers, []);
  assert.deepEqual(result.pageWarnings, [
    { code: "unassigned_page_detection_failed", pageNumber: 2 },
  ]);
  assert.ok(
    result.extractionPageIssues?.some(
      (issue) => issue.code === "page_count_mismatch",
    ),
  );
  assert.equal(result.documentStatus, "error");
});

test("over-counts and exact counts skip blank-page detection", async (t) => {
  for (const scenario of [
    {
      name: "over-count",
      physicalPageCount: 1,
      reportedPageCount: 2,
      status: "error" as const,
    },
    {
      name: "exact count",
      physicalPageCount: 1,
      reportedPageCount: 1,
      status: "accepted" as const,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const state = await buildState(scenario.physicalPageCount);
      const detectorCalls: number[] = [];
      const node = createExtractDocumentNode({
        extractionClient: {
          extract: async () =>
            response(scenario.reportedPageCount, [
              buildCertificate("certificate-1", [1]),
            ]),
        },
        pdfBlankPageDetector: blankPageDetector(true, detectorCalls),
        signatureVisualDetector: {
          detect: async () => visualResult(0.9),
        },
        signatureVisualMinConfidence: 0.86,
        pdfTextLayerExtractor: positionedSignerText(),
        pdfRegionRenderer: cropRenderer,
        logger,
      });

      const result = await node(state);
      assert.deepEqual(detectorCalls, []);
      assert.equal(result.documentStatus, scenario.status);
    });
  }
});

test("a single certificate spanning multiple pages keeps normal PDF generation", async () => {
  const state = await buildState(3);
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(3, [buildCertificate("certificate-1", [1, 2, 3])]),
    },
    signatureVisualDetector: {
      detect: async () => visualResult(0.9),
    },
    signatureVisualMinConfidence: 0.86,
    pdfTextLayerExtractor: positionedSignerText(),
    pdfRegionRenderer: cropRenderer,
    logger,
  });

  const result = await node(state);

  assert.equal(result.certificateSelection, undefined);
  assert.equal(result.certificates?.length, 1);
  assert.equal(result.certificates?.[0]?.status, "accepted");
  assert.ok(result.certificates?.[0]?.certificatePdfBase64);
  assert.equal(result.documentStatus, "accepted");
});

test("visual signature promotion requires confidence 0.86 and a visible signer band", async (t) => {
  for (const scenario of [
    { name: "promoted", confidence: 0.86, signerBand: true, promoted: true },
    {
      name: "below threshold",
      confidence: 0.78,
      signerBand: true,
      promoted: false,
    },
    {
      name: "missing signer band",
      confidence: 0.99,
      signerBand: false,
      promoted: false,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const state = await buildState(1);
      const detector: SignatureVisualDetector = {
        detect: async () =>
          visualResult(scenario.confidence, scenario.signerBand),
      };
      const certificate = buildCertificate("certificate-1", [1], {
        signer: {
          printedName: null,
          title: null,
          tin: null,
          companyName: null,
          signature: {
            present: false,
            confidence: 0.2,
            pageNumber: null,
            source: "gemini",
          },
        },
      });
      const node = createExtractDocumentNode({
        extractionClient: withPayorCrop(
          { extract: async () => response(1, [certificate]) },
          {
            printedName: null,
            title: null,
            tin: null,
            companyName: null,
          },
        ),
        signatureVisualDetector: detector,
        signatureVisualMinConfidence: 0.86,
        pdfRegionRenderer: cropRenderer,
        logger,
      });

      const result = await node(state);
      assert.equal(
        result.certificates?.[0]?.effective.signer.signature.present,
        scenario.promoted,
      );
      assert.equal(
        result.certificates?.[0]?.signatureFallback.promoted,
        scenario.promoted,
      );
    });
  }
});

test("Gemini-positive signature remains authoritative below the visual confidence threshold", async () => {
  const state = await buildState(1);
  const certificate = buildCertificate("certificate-1", [1], {
    signer: {
      printedName: "SIGNER NAME",
      title: "Manager",
      tin: "901327847000",
      companyName: null,
      signature: {
        present: true,
        confidence: 0.5,
        pageNumber: 1,
        source: "gemini",
      },
    },
  });
  const node = createExtractDocumentNode({
    extractionClient: { extract: async () => response(1, [certificate]) },
    signatureVisualDetector: {
      detect: async () => visualResult(0.78, true),
    },
    signatureVisualMinConfidence: 0.86,
    pdfTextLayerExtractor: positionedSignerText(),
    pdfRegionRenderer: cropRenderer,
    logger,
  });

  const result = await node(state);
  const signature = result.certificates?.[0]?.effective.signer.signature;
  assert.equal(result.certificates?.[0]?.signatureFallback.promoted, false);
  assert.equal(signature?.present, true);
  assert.equal(signature?.confidence, 0.5);
  assert.equal(signature?.source, "gemini");
  assert.equal(result.certificates?.[0]?.status, "accepted");
  assert.equal(
    result.certificates?.[0]?.reasonCodes.includes(
      "signature_confidence_below_threshold",
    ),
    false,
  );
});

test("disabled payor signer verification preserves Gemini identity and skips verifier dependencies", async () => {
  const state = await buildState(1);
  const certificate = buildCertificate("certificate-1", [1], {
    signer: {
      printedName: "JOAN GRACE D. ANGGOT",
      title: "FSD MANAGER",
      tin: null,
      companyName: null,
      signature: {
        present: true,
        confidence: 0.95,
        pageNumber: 1,
        source: "gemini",
      },
    },
  });
  let textLayerCalls = 0;
  let cropRenderCalls = 0;
  let cropExtractionCalls = 0;
  const positionedText = positionedSignerText({
    printedName: "JOAN GRACE D. ANGGOT",
    title: "FSD MANAGER",
  });
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () => response(1, [certificate]),
      extractPayorSigner: async () => {
        cropExtractionCalls += 1;
        return {
          result: {
            printedName: null,
            title: null,
            tin: null,
            companyName: null,
            confidence: 0.95,
            warnings: [],
          },
          metadata,
        };
      },
    },
    signatureVisualDetector: {
      detect: async () => visualResult(0.78, true),
    },
    signatureVisualMinConfidence: 0.86,
    payorSignerVerificationEnabled: false,
    pdfTextLayerExtractor: {
      extract: async (input) => {
        textLayerCalls += 1;
        return positionedText.extract(input);
      },
    },
    pdfRegionRenderer: {
      render: async (input) => {
        cropRenderCalls += 1;
        return cropRenderer.render(input);
      },
    },
    logger,
  });

  const result = await node(state);
  const processed = result.certificates?.[0];
  assert.equal(processed?.effective.signer.printedName, "JOAN GRACE D. ANGGOT");
  assert.equal(processed?.effective.signer.title, "FSD MANAGER");
  assert.equal(processed?.effective.signer.signature.present, true);
  assert.equal(processed?.effective.signer.signature.source, "gemini");
  assert.equal(
    processed?.signatureFallback.payorSignerVerification?.status,
    "not_run",
  );
  assert.equal(
    processed?.signatureFallback.textLayerRecovery?.status,
    "not_run",
  );
  assert.equal(textLayerCalls, 0);
  assert.equal(cropRenderCalls, 0);
  assert.equal(cropExtractionCalls, 0);
  assert.equal(processed?.status, "accepted");
  assert.equal(result.documentStatus, "accepted");
});

test("Gemini-positive signature is retained after visual detector failure", async () => {
  const state = await buildState(1);
  const certificate = buildCertificate("certificate-1", [1], {
    signer: {
      printedName: "SIGNER NAME",
      title: "Manager",
      tin: "901327847000",
      companyName: null,
      signature: {
        present: true,
        confidence: 0.5,
        pageNumber: 1,
        source: "gemini",
      },
    },
  });
  const node = createExtractDocumentNode({
    extractionClient: { extract: async () => response(1, [certificate]) },
    signatureVisualDetector: {
      detect: async () => {
        throw new Error("renderer unavailable");
      },
    },
    signatureVisualMinConfidence: 0.86,
    logger,
  });

  const result = await node(state);
  const signature = result.certificates?.[0]?.effective.signer.signature;
  assert.equal(signature?.present, true);
  assert.equal(signature?.confidence, 0.5);
  assert.equal(signature?.source, "gemini");
  assert.equal(result.certificates?.[0]?.status, "error");
  assert.deepEqual(result.certificates?.[0]?.reasonCodes, [
    "payor_signer_block_unverifiable",
  ]);
});

test("confirmed payor identity prevents a negative visual result from vetoing Gemini", async () => {
  const state = await buildState(1);
  const certificate = buildCertificate("certificate-1", [1]);
  const node = createExtractDocumentNode({
    extractionClient: { extract: async () => response(1, [certificate]) },
    signatureVisualDetector: {
      detect: async () => visualResult(0.2, true, false),
    },
    signatureVisualMinConfidence: 0.86,
    pdfTextLayerExtractor: positionedSignerText(),
    pdfRegionRenderer: cropRenderer,
    logger,
  });

  const result = await node(state);
  const processed = result.certificates?.[0];
  assert.equal(processed?.effective.signer.signature.present, true);
  assert.equal(processed?.effective.signer.signature.source, "gemini");
  assert.equal(processed?.signatureFallback.promoted, false);
  assert.equal(processed?.signatureFallback.disagreement, true);
  assert.equal(
    processed?.signatureFallback.payorSignerVerification?.status,
    "confirmed",
  );
  assert.equal(processed?.status, "accepted");
});

test("positioned payor text confirms identity but cannot set signature presence", async () => {
  const state = await buildState(1);
  const extractor = positionedSignerText({
    printedName: "JUAN DELA CRUZ",
    title: "Finance Manager",
    tin: "901-327-847-000",
  });
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () =>
        response(1, [
          buildCertificate("certificate-1", [1], {
            signer: {
              printedName: "JUAN DELA CRUZ",
              title: "Finance Manager",
              tin: "901327847000",
              companyName: null,
              signature: {
                present: false,
                confidence: 0.1,
                pageNumber: null,
                source: "gemini",
              },
            },
          }),
        ]),
    },
    signatureVisualDetector: {
      detect: async () => visualResult(0.78, true),
    },
    signatureVisualMinConfidence: 0.86,
    pdfTextLayerExtractor: extractor,
    logger,
  });

  const result = await node(state);
  const certificate = result.certificates?.[0];
  assert.equal(certificate?.effective.signer.printedName, "JUAN DELA CRUZ");
  assert.equal(certificate?.effective.signer.signature.present, false);
  assert.equal(
    certificate?.signatureFallback.payorSignerVerification?.source,
    "text_layout",
  );
  assert.deepEqual(
    certificate?.signatureFallback.textLayerRecovery?.recoveredFields,
    ["printedName", "title", "tin"],
  );
  assert.equal(
    JSON.stringify(result).includes("JUAN DELA CRUZ\nFinance Manager"),
    false,
  );
});

test("a lower payee signer cannot populate a blank payor block", async () => {
  const state = await buildState(1);
  const certificate = buildCertificate("certificate-1", [1], {
    signer: {
      printedName: "LOWER PAYEE SIGNER",
      title: "Payee Treasurer",
      tin: "111222333000",
      companyName: "PAYEE COMPANY",
      signature: {
        present: true,
        confidence: 0.99,
        pageNumber: 1,
        source: "gemini",
      },
    },
  });
  const lowerPayeeText: PdfTextLayerExtractor = {
    extract: async () => ({
      text: "CONFORME\nLOWER PAYEE SIGNER\nPayee Treasurer\n111-222-333-000",
      page: { width: 200, height: 200 },
      lines: [
        {
          text: "CONFORME",
          bounds: { left: 20, top: 181, right: 80, bottom: 187 },
        },
        {
          text: "LOWER PAYEE SIGNER",
          bounds: { left: 20, top: 188, right: 180, bottom: 195 },
        },
      ],
      metadata: {
        extractor: "pdftotext",
        layout: true,
        positioned: true,
        elapsedMs: 2,
        originalPdfBytes: 100,
        textLength: 65,
      },
    }),
  };
  const node = createExtractDocumentNode({
    extractionClient: withPayorCrop(
      { extract: async () => response(1, [certificate]) },
      {
        printedName: null,
        title: null,
        tin: null,
        companyName: null,
      },
    ),
    signatureVisualDetector: {
      detect: async () => visualResult(0.2, true, false),
    },
    signatureVisualMinConfidence: 0.86,
    pdfTextLayerExtractor: lowerPayeeText,
    pdfRegionRenderer: cropRenderer,
    logger,
  });

  const result = await node(state);
  const processed = result.certificates?.[0];
  assert.equal(processed?.effective.signer.printedName, null);
  assert.equal(processed?.effective.signer.title, null);
  assert.equal(processed?.effective.signer.tin, null);
  assert.equal(processed?.effective.signer.companyName, null);
  assert.equal(processed?.effective.signer.signature.present, false);
  assert.equal(
    processed?.signatureFallback.payorSignerVerification?.status,
    "missing",
  );
  assert.equal(
    processed?.signatureFallback.payorSignerVerification?.source,
    "gemini_crop",
  );
});

test("zero-certificate classifications produce controlled error status", async (t) => {
  for (const scenario of [
    {
      name: "non BIR",
      documentType: "NON_BIR_2307" as const,
      status: "error",
    },
    {
      name: "unknown",
      documentType: "UNKNOWN" as const,
      status: "error",
    },
  ]) {
    await t.test(scenario.name, async () => {
      const state = await buildState(1);
      const node = createExtractDocumentNode({
        extractionClient: {
          extract: async () => response(1, [], scenario.documentType),
        },
        signatureVisualMinConfidence: 0.86,
        logger,
      });
      const result = await node(state);
      assert.equal(result.certificates?.length, 0);
      assert.equal(result.documentStatus, scenario.status);
    });
  }
});

test("Gemini terminal failures retain only specific sanitized telemetry", async () => {
  const state = await buildState(1);
  const node = createExtractDocumentNode({
    extractionClient: {
      extract: async () => {
        throw new GeminiExtractionError(
          "Gemini response contained PRIVATE RESPONSE CONTENT",
          {
            failureCode: "gemini_schema_validation_failed",
            attemptCount: 3,
            latencyMs: 12_000,
            timeout: false,
            retryable: true,
            responseModel: "gemini-3-flash-preview-20260701",
            usage: {
              promptTokenCount: 110,
              outputTokenCount: 70,
              thoughtTokenCount: 30,
              totalTokenCount: 210,
            },
            schemaIssues: [
              {
                path: "certificates.[].taxRows.[].taxBase",
                code: "invalid_type",
              },
            ],
          },
        );
      },
    },
    signatureVisualMinConfidence: 0.86,
    logger,
  });

  const result = await node(state);

  assert.equal(result.documentStatus, "error");
  assert.deepEqual(result.reasonCodes, ["gemini_schema_validation_failed"]);
  assert.equal(result.sourceContentBase64, undefined);
  assert.deepEqual(result.extractionFailureTelemetry, {
    provider: "gemini",
    failureCode: "gemini_schema_validation_failed",
    attemptCount: 3,
    latencyMs: 12_000,
    status: undefined,
    timeout: false,
    retryable: true,
    responseModel: "gemini-3-flash-preview-20260701",
    promptTokenCount: 110,
    outputTokenCount: 70,
    thoughtTokenCount: 30,
    totalTokenCount: 210,
    schemaIssues: [
      { path: "certificates.[].taxRows.[].taxBase", code: "invalid_type" },
    ],
    errorCode: "gemini_schema_validation_failed",
  });
  assert.doesNotMatch(
    JSON.stringify(result.extractionFailureTelemetry),
    /PRIVATE RESPONSE CONTENT|private-pdf/iu,
  );
});
