import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { createExtractDocumentNode } from "./extractDocument.ts";
import type { WorkflowState } from "../types.ts";
import type { PdfZoneRenderer } from "../utils/pdfZoneRenderer.ts";
import type {
  SignatureVisualDetectionResult,
  SignatureVisualDetector,
} from "../utils/signatureVisualDetector.ts";
import type { Bir2307ZoneId } from "../utils/zoneOcr.ts";
import type { ZoneOcrFallbackConfig } from "../utils/zoneOcrFallback.ts";

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

const completeCertificateText = `
  Republic of the Philippines
  Department of Finance
  Bureau of Internal Revenue
  BIR Form No. 2307
  Certificate of Creditable Tax Withheld at Source
  1 For the Period From 04 01 2026 To 04 30 2026
  2 Taxpayer Identification Number (TIN) 005-031-663-00000
  3 Payee's Name Therma Visayas, Inc.
  6 Taxpayer Identification Number (TIN) 000-202-524-0000
  7 Payor's Name Dagupan Electric Corporation
  Part III Details of Monthly Income Payments and Taxes Withheld
  Income Payments Subject to Expanded Withholding Tax ATC Amount of Income Payments Tax Withheld for the Quarter
  Payment made by top 10,000 corporations WC160 116,833.55 116,833.55 2,336.67
  LILIAN D. SARALDE Finance Manager (901-327-847-000)
  Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent
  CONFORME:
`;

const memoText = "Cover sheet memo with supporting schedules.";

interface OcrCall {
  revision: string;
  mimeType: string;
  content: Buffer;
  requestProfile?: string;
}

async function buildPdf(pageCount: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([200, 200]);
  }

  return Buffer.from(await document.save());
}

function buildState(pageCount: number): Promise<WorkflowState> {
  return buildPdf(pageCount).then(
    (pdf) =>
      ({
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
      }) as WorkflowState,
  );
}

function buildCertificateAnnotation(
  payeeName = "Therma Visayas, Inc.",
  signaturePresent: boolean | null = true,
  overrides: Record<string, unknown> = {},
) {
  const annotation = {
    periodStart: "04-01-2026",
    periodEnd: "04-30-2026",
    periodCovered: "04-01-2026 to 04-30-2026",
    payeeName,
    payeeTin: "00503166300000",
    payorName: "Dagupan Electric Corporation",
    payorTin: "0002025240000",
    atcCode: "WC160",
    taxBase: 116833.55,
    taxWithheld: 2336.67,
    printedName: "LILIAN D. SARALDE",
    signatoryTitle: "Finance Manager",
    signatoryTin: "901327847000",
    signaturePresent,
    confidences: {
      payeeName: 0.98,
      signaturePresent: 0.9,
    },
  };

  return {
    ...annotation,
    ...overrides,
  };
}

function defaultZoneOcrConfig(
  overrides: Partial<ZoneOcrFallbackConfig> = {},
): ZoneOcrFallbackConfig {
  return {
    enabled: true,
    maxZonesPerPage: 4,
    singlePageRescueEnabled: true,
    ...overrides,
  };
}

function createTestZoneRenderer(): PdfZoneRenderer {
  return {
    async render(input) {
      const content = Buffer.from(`${input.zone.id}-png`);
      return {
        content,
        mimeType: "image/png",
        metadata: {
          zoneId: input.zone.id,
          renderDpi: 300,
          renderMimeType: "image/png",
          renderElapsedMs: 1,
          originalPdfBytes: input.content.byteLength,
          renderedPngBytes: content.byteLength,
          cropPixels: { x: 0, y: 0, width: 100, height: 40 },
          pagePixels: { width: 200, height: 200 },
          renderer: "pdftoppm",
        },
      };
    },
  };
}

function buildDetectedSignatureVisualResult(
  overrides: Partial<SignatureVisualDetectionResult> = {},
): SignatureVisualDetectionResult {
  return {
    status: "detected",
    signaturePresent: true,
    confidence: 0.78,
    metrics: {
      darkPixelCount: 42634,
      candidateCount: 1,
      largestCandidateArea: 553,
      largestCandidateWidth: 42,
      largestCandidateHeight: 63,
      analysisWidth: 1904,
      analysisHeight: 188,
    },
    render: {
      dpi: 300,
      elapsedMs: 197,
      cropPixels: { x: 298, y: 2353, width: 1904, height: 521 },
      pagePixels: { width: 2481, height: 3509 },
    },
    ...overrides,
  };
}

function buildSignerBandOnlyVisualResult(
  overrides: Partial<SignatureVisualDetectionResult> = {},
): SignatureVisualDetectionResult {
  return {
    status: "not_detected",
    signaturePresent: false,
    confidence: 0,
    anchorOcrEligible: true,
    anchorOcrReason: "payor_signer_band_visible",
    structure: {
      payorSignerBandVisible: true,
      structuredWindowCount: 1,
      analysisWindowCount: 1,
    },
    metrics: {
      darkPixelCount: 24918,
      candidateCount: 0,
      largestCandidateArea: 0,
      largestCandidateWidth: 0,
      largestCandidateHeight: 0,
      analysisWidth: 1904,
      analysisHeight: 181,
    },
    render: {
      dpi: 300,
      elapsedMs: 237,
      cropPixels: { x: 298, y: 2047, width: 1904, height: 949 },
      pagePixels: { width: 2481, height: 3509 },
    },
    ...overrides,
  };
}

function buildNode(
  textByPage: string[],
  options: {
    calls?: OcrCall[];
    omitAnnotationPages?: number[];
    signaturePresent?: boolean | null;
    signatureVisualDetector?: SignatureVisualDetector;
    annotationOverridesByPage?: Record<number, Record<string, unknown>>;
    zoneOcrConfig?: ZoneOcrFallbackConfig;
    zoneRenderer?: PdfZoneRenderer;
    zoneTextById?: Partial<Record<Bir2307ZoneId, string>>;
    zoneAnnotationById?: Partial<
      Record<Bir2307ZoneId, Record<string, unknown>>
    >;
    zoneTextByCandidateId?: Partial<Record<string, string>>;
    failingZoneIds?: Bir2307ZoneId[];
    failingZoneCandidateIds?: string[];
  } = {},
) {
  return createExtractDocumentNode({
    logger: logger as never,
    signatureVisualDetector: options.signatureVisualDetector,
    zoneOcrConfig: options.zoneOcrConfig,
    zoneRenderer: options.zoneOcrConfig
      ? (options.zoneRenderer ?? createTestZoneRenderer())
      : undefined,
    ocrClient: {
      async extract(input) {
        options.calls?.push({
          revision: input.revision,
          mimeType: input.mimeType,
          content: input.content,
          requestProfile: input.requestProfile,
        });

        const zoneMatch = input.revision.match(
          /-zone-(header_period|payee_payor_info|tax_table|signature_block)(?:-candidate-([a-z0-9_]+))?$/u,
        );
        const zoneId = zoneMatch?.[1] as Bir2307ZoneId | undefined;
        const candidateId = zoneMatch?.[2];
        if (zoneId) {
          if (
            options.failingZoneIds?.includes(zoneId) ||
            (candidateId &&
              options.failingZoneCandidateIds?.includes(candidateId))
          ) {
            throw new Error(`zone failed: ${zoneId}`);
          }

          const parsedText =
            (candidateId
              ? options.zoneTextByCandidateId?.[candidateId]
              : undefined) ??
            options.zoneTextById?.[zoneId] ??
            "";
          return {
            provider: "test-zone",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: 1,
            raw: {
              text: parsedText,
              pages: [{ markdown: parsedText }],
              model: "test-zone-ocr-model",
              usage_info: { pages_processed: 1 },
              ...(options.zoneAnnotationById?.[zoneId]
                ? {
                    document_annotation: options.zoneAnnotationById[zoneId],
                  }
                : {}),
            },
            parsedText,
            metadata: {
              model: "test-zone-ocr-model",
              responseModel: "test-zone-ocr-model",
              requestPayloadChars: 45,
              usageInfo: { pages_processed: 1 },
              requestProfile: input.requestProfile,
            },
          };
        }

        const pageNumber = Number(
          input.revision.match(/page-(\d+)(?:-|$)/u)?.[1],
        );
        const parsedText = textByPage[pageNumber - 1] ?? "";
        const hasAnnotation =
          !options.omitAnnotationPages?.includes(pageNumber) &&
          parsedText.includes("BIR Form No. 2307");

        return {
          provider: "test",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
          raw: {
            text: parsedText,
            pages: [{ markdown: parsedText }],
            model: "test-ocr-model",
            usage_info: { pages_processed: 1 },
            ...(hasAnnotation
              ? {
                  document_annotation: buildCertificateAnnotation(
                    `Payee Page ${pageNumber}`,
                    "signaturePresent" in options
                      ? (options.signaturePresent ?? null)
                      : true,
                    options.annotationOverridesByPage?.[pageNumber],
                  ),
                }
              : {}),
          },
          parsedText,
          metadata: {
            model: "test-ocr-model",
            responseModel: "test-ocr-model",
            requestPayloadChars: 123,
            usageInfo: { pages_processed: 1 },
          },
        };
      },
    },
  });
}

test("extractDocument continues for one certificate page and ignores non-certificate pages", async () => {
  const calls: Array<{ revision: string; mimeType: string; content: Buffer }> =
    [];
  const extractDocument = buildNode([memoText, certificateText, memoText], {
    calls,
  });
  const result = await extractDocument(await buildState(3));

  assert.equal(result.decision?.route, "continue");
  assert.equal(result.decision?.phase, "validate");
  assert.equal(calls.length, 3);
  assert.equal(
    calls.every((call) => call.mimeType === "application/pdf"),
    true,
  );
  assert.equal(result.extraction?.parsedText, certificateText);
  assert.equal(result.normalized?.payeeName, "Payee Page 2");
  assert.equal(result.pages?.[1]?.normalized?.payeeName, "Payee Page 2");
  assert.deepEqual(result.batchSummary?.certificatePageNumbers, [2]);
  assert.deepEqual(result.batchSummary?.ignoredPageNumbers, [1, 3]);
});

test("extractDocument promotes signaturePresent from local visual fallback without another OCR call", async () => {
  const calls: Array<{ revision: string; mimeType: string; content: Buffer }> =
    [];
  let visualCalls = 0;
  const extractDocument = buildNode([certificateText], {
    calls,
    signaturePresent: false,
    signatureVisualDetector: {
      async detect(input) {
        visualCalls += 1;
        assert.equal(input.pageNumber, 1);
        return {
          status: "detected",
          signaturePresent: true,
          confidence: 0.86,
          metrics: {
            darkPixelCount: 1000,
            candidateCount: 1,
            largestCandidateArea: 150,
            largestCandidateWidth: 120,
            largestCandidateHeight: 24,
            analysisWidth: 400,
            analysisHeight: 80,
          },
          render: {
            dpi: 300,
            elapsedMs: 5,
            cropPixels: { x: 0, y: 0, width: 400, height: 120 },
            pagePixels: { width: 800, height: 1000 },
          },
        };
      },
    },
  });

  const result = await extractDocument(await buildState(1));

  assert.equal(calls.length, 1);
  assert.equal(visualCalls, 1);
  assert.equal(result.normalized?.signaturePresent, true);
  assert.equal(result.normalized?.signature, true);
  const payload = result.normalized?.normalizerPayload as Record<
    string,
    unknown
  >;
  assert.equal(
    (payload.signatureVisualFallback as Record<string, unknown>).promoted,
    true,
  );
});

test("extractDocument skips zone fallback when full OCR already has required BIR 2307 zones", async () => {
  const calls: OcrCall[] = [];
  const extractDocument = buildNode([completeCertificateText], {
    calls,
    zoneOcrConfig: defaultZoneOcrConfig(),
  });

  const result = await extractDocument(await buildState(1));

  assert.equal(result.decision?.route, "continue");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.mimeType, "application/pdf");
  assert.equal(calls[0]?.requestProfile, undefined);
  assert.equal(
    (result.extraction?.metadata.zoneOcrFallback as Record<string, unknown>)
      .status,
    "skipped",
  );
  assert.deepEqual(
    (result.extraction?.metadata.zoneOcrFallback as Record<string, unknown>)
      .triggeredZones,
    [],
  );
});

test("extractDocument runs signature block zone OCR when main OCR omits the bottom section", async () => {
  const calls: OcrCall[] = [];
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    zoneOcrConfig: defaultZoneOcrConfig(),
    zoneTextById: {
      signature_block: `
        LILIAN D. SARALDE Finance Manager (901-327-847-000)
        Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent
        CONFORME:
      `,
    },
  });

  const result = await extractDocument(await buildState(1));
  const zoneCall = calls.find((call) =>
    call.revision.includes("-zone-signature_block"),
  );
  const payload = result.normalized?.normalizerPayload as Record<
    string,
    unknown
  >;

  assert.equal(result.decision?.route, "continue");
  assert.equal(calls.length, 2);
  assert.equal(zoneCall?.mimeType, "image/png");
  assert.equal(zoneCall?.requestProfile, "signature_block_annotation");
  assert.equal(payload.zoneFallbackStatus, "completed");
  assert.equal(payload.zoneFallbackBlockCount, 1);
  assert.equal(Array.isArray(result.extraction?.raw.zoneOcrFallbackText), true);
});

test("extractDocument swaps signer fields from signature block zone annotation", async () => {
  const calls: OcrCall[] = [];
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    zoneOcrConfig: defaultZoneOcrConfig(),
    annotationOverridesByPage: {
      1: {
        printedName: "REGULATORY AGENT DATE",
        signatoryTitle:
          "Authorized Representative Tax Agent Include Title Designation And Tni",
        signatoryTin: null,
        confidences: {
          printedName: 0.95,
          signatoryTitle: 0.95,
          signatoryTin: 0.95,
        },
      },
    },
    zoneTextById: {
      signature_block: `
        Raymundo, Marie Claire Chief Accountant 211-176-064 SM 6/25/2025
        Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent
        CONFORME:
      `,
    },
    zoneAnnotationById: {
      signature_block: {
        printedName: "Raymundo, Marie Claire",
        signatoryTitle: "Chief Accountant",
        signatoryTin: "211-176-064",
        signaturePresent: null,
        signatureText: null,
        confidences: {
          printedName: 0.91,
          signatoryTitle: 0.9,
          signatoryTin: 0.92,
          signaturePresent: 0,
          signatureText: 0,
        },
        warnings: [],
      },
    },
  });

  const result = await extractDocument(await buildState(1));
  const signatureCall = calls.find((call) =>
    call.revision.includes("-zone-signature_block"),
  );
  const zones = ((
    result.extraction?.metadata.zoneOcrFallback as Record<string, unknown>
  ).zones ?? []) as Array<Record<string, unknown>>;
  const signatureZone = zones.find((zone) => zone.zoneId === "signature_block");

  assert.equal(result.decision?.route, "continue");
  assert.equal(signatureCall?.requestProfile, "signature_block_annotation");
  assert.equal(result.normalized?.printedName, "Raymundo, Marie Claire");
  assert.equal(result.normalized?.signatoryTitle, "Chief Accountant");
  assert.equal(result.normalized?.signatoryTin, "211176064");
  assert.equal(
    (signatureZone?.fallbackAnnotation as Record<string, unknown>).printedName,
    "Raymundo, Marie Claire",
  );
});

test("extractDocument runs payee/payor zone OCR and recovers boxed TIN rows", async () => {
  const calls: OcrCall[] = [];
  const mainText = completeCertificateText
    .replace("005-031-663-00000", "")
    .replace("000-202-524-0000", "");
  const extractDocument = buildNode([mainText], {
    calls,
    zoneOcrConfig: defaultZoneOcrConfig(),
    annotationOverridesByPage: {
      1: {
        payeeTin: null,
        payorTin: null,
      },
    },
    zoneTextById: {
      payee_payor_info: `
        | 2 Taxpayer Identification Number (TIN) | 0 | 0 | 5 | 0 | 3 | 1 | 6 | 6 | 3 | 0 | 0 | 0 | 0 | 0 |
        | 3 Payee's Name | Therma Visayas, Inc. |
        | 6 Taxpayer Identification Number (TIN) | 0 | 0 | 0 | 2 | 0 | 2 | 5 | 2 | 4 | 0 | 0 | 0 | 0 |
        | 7 Payor's Name | Dagupan Electric Corporation |
      `,
    },
  });

  const result = await extractDocument(await buildState(1));
  const zoneCall = calls.find((call) =>
    call.revision.endsWith("-zone-payee_payor_info"),
  );

  assert.equal(result.decision?.route, "continue");
  assert.equal(calls.length, 2);
  assert.equal(zoneCall?.requestProfile, "zone_text");
  assert.equal(result.normalized?.payeeTin, "00503166300000");
  assert.equal(result.normalized?.payorTin, "0002025240000");
});

test("extractDocument records zone OCR failures without crashing extraction", async () => {
  const calls: OcrCall[] = [];
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    zoneOcrConfig: defaultZoneOcrConfig(),
    failingZoneIds: ["signature_block"],
  });

  const result = await extractDocument(await buildState(1));
  const fallback = result.extraction?.metadata.zoneOcrFallback as Record<
    string,
    unknown
  >;
  const failures = fallback.failures as Array<Record<string, unknown>>;

  assert.equal(result.decision?.route, "continue");
  assert.equal(
    calls.filter((call) => call.revision.includes("-zone-signature_block"))
      .length,
    3,
  );
  assert.equal(fallback.status, "failed");
  assert.equal(failures[0]?.zoneId, "signature_block");
  assert.equal(result.extraction?.raw.zoneOcrFallbackText, undefined);
});

test("extractDocument discards low-signal signature block OCR text", async () => {
  const calls: OcrCall[] = [];
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    zoneOcrConfig: defaultZoneOcrConfig(),
    annotationOverridesByPage: {
      1: {
        printedName: null,
        signatoryTitle: null,
        signatoryTin: null,
        signaturePresent: null,
      },
    },
    zoneTextById: {
      signature_block:
        "fsc 8000 division of general planning 2307 certificate 2.00 3.00 4.00 5.00 note the bpr data privacy website",
    },
  });

  const result = await extractDocument(await buildState(1));
  const fallback = result.extraction?.metadata.zoneOcrFallback as Record<
    string,
    unknown
  >;
  const discardedZones = fallback.discardedZones as Array<
    Record<string, unknown>
  >;
  const payload = result.normalized?.normalizerPayload as Record<
    string,
    unknown
  >;

  assert.equal(result.decision?.route, "continue");
  assert.equal(
    calls.filter((call) => call.revision.includes("-zone-signature_block"))
      .length,
    3,
  );
  assert.equal(fallback.status, "completed_no_usable_text");
  assert.equal(discardedZones[0]?.zoneId, "signature_block");
  assert.equal(discardedZones[0]?.reason, "signature_low_signal");
  assert.match(String(discardedZones[0]?.preview), /fsc 8000/u);
  assert.equal(result.extraction?.raw.zoneOcrFallbackText, undefined);
  assert.equal(payload.zoneFallbackBlockCount, 0);
  assert.equal(result.normalized?.printedName, undefined);
});

test("extractDocument tries bounded signature crop candidates until signer text is usable", async () => {
  const calls: OcrCall[] = [];
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    zoneOcrConfig: defaultZoneOcrConfig(),
    annotationOverridesByPage: {
      1: {
        printedName: null,
        signatoryTitle: null,
        signatoryTin: null,
        signaturePresent: null,
      },
    },
    zoneTextByCandidateId: {
      payor_left_lower: "",
      payor_left_upper:
        "fsc 8000 division of general planning 2307 certificate 2.00",
      payor_wide_lower:
        "LEON D. SARALDE Finance Manager (901-327-847-000)\nSignature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent",
    },
    zoneAnnotationById: {
      signature_block: buildCertificateAnnotation("Ignored", null, {
        printedName: "LEON D. SARALDE",
        signatoryTitle: "Finance Manager",
        signatoryTin: "901-327-847-000",
      }),
    },
  });

  const result = await extractDocument(await buildState(1));
  const fallback = result.extraction?.metadata.zoneOcrFallback as Record<
    string,
    unknown
  >;
  const discardedZones = fallback.discardedZones as Array<
    Record<string, unknown>
  >;
  const zoneCalls = calls.filter((call) =>
    call.revision.includes("-zone-signature_block"),
  );

  assert.equal(result.decision?.route, "continue");
  assert.equal(zoneCalls.length, 3);
  assert.equal(fallback.status, "completed");
  assert.equal(discardedZones.length, 2);
  assert.equal(discardedZones[0]?.reason, "empty_text");
  assert.equal(discardedZones[1]?.reason, "signature_low_signal");
  assert.equal(result.normalized?.printedName, "LEON D. SARALDE");
  assert.equal(result.normalized?.signatoryTitle, "Finance Manager");
  assert.equal(result.normalized?.signatoryTin, "901327847000");
  assert.equal(result.normalized?.signaturePresent, undefined);
  assert.equal(result.normalized?.signature, undefined);
  assert.equal(
    (result.extraction?.raw.zoneOcrFallbackText as Array<unknown>).length,
    1,
  );
});

test("extractDocument uses visual-anchor signature OCR before fixed signature crops", async () => {
  const calls: OcrCall[] = [];
  let visualCalls = 0;
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    signaturePresent: false,
    zoneOcrConfig: defaultZoneOcrConfig(),
    annotationOverridesByPage: {
      1: {
        printedName: null,
        signatoryTitle: null,
        signatoryTin: null,
        signaturePresent: null,
      },
    },
    zoneTextByCandidateId: {
      visual_anchor_payor_region:
        "MARIA C. SANTOS\nFinance Manager (123-456-789-000)\nSignature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent",
      payor_left_upper:
        "signature over printed name of payee payee s authorized indicate title designation",
    },
    zoneAnnotationById: {
      signature_block: buildCertificateAnnotation("Ignored", null, {
        printedName: "MARIA C. SANTOS",
        signatoryTitle: "Finance Manager",
        signatoryTin: "123-456-789-000",
      }),
    },
    signatureVisualDetector: {
      async detect() {
        visualCalls += 1;
        return buildDetectedSignatureVisualResult();
      },
    },
  });

  const result = await extractDocument(await buildState(1));
  const fallback = result.extraction?.metadata.zoneOcrFallback as Record<
    string,
    unknown
  >;
  const zones = fallback.zones as Array<Record<string, unknown>>;
  const signatureZone = zones.find(
    (zone) => zone.candidateId === "visual_anchor_payor_region",
  );
  const zoneCalls = calls.filter((call) =>
    call.revision.includes("-zone-signature_block"),
  );

  assert.equal(result.decision?.route, "continue");
  assert.equal(visualCalls, 1);
  assert.equal(zoneCalls.length, 1);
  assert.match(
    String(zoneCalls[0]?.revision),
    /-zone-signature_block-candidate-visual_anchor_payor_region$/u,
  );
  assert.equal(signatureZone?.candidateSource, "visual_anchor");
  assert.equal(signatureZone?.candidateCount, 3);
  assert.equal(result.normalized?.printedName, "MARIA C. SANTOS");
  assert.equal(result.normalized?.signatoryTitle, "Finance Manager");
  assert.equal(result.normalized?.signatoryTin, "123456789000");
  assert.equal(result.normalized?.signaturePresent, true);
  assert.equal(result.normalized?.signature, true);
});

test("extractDocument uses structural visual-anchor signer OCR without promoting signature", async () => {
  const calls: OcrCall[] = [];
  let visualCalls = 0;
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    signaturePresent: null,
    zoneOcrConfig: defaultZoneOcrConfig(),
    annotationOverridesByPage: {
      1: {
        printedName: null,
        signatoryTitle: null,
        signatoryTin: null,
        signaturePresent: null,
      },
    },
    zoneTextByCandidateId: {
      visual_anchor_payor_region:
        "SHARON ROSE Z. MEDINA / Manager Accounting / 201-308-097-000\nSignature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent\nCONFORME:",
      payor_left_upper:
        "signature over printed name of payee payee s authorized indicate title designation",
    },
    zoneAnnotationById: {
      signature_block: buildCertificateAnnotation("Ignored", null, {
        printedName: "SHARON ROSE Z. MEDINA",
        signatoryTitle: "Manager Accounting",
        signatoryTin: "201-308-097-000",
      }),
    },
    signatureVisualDetector: {
      async detect() {
        visualCalls += 1;
        return buildSignerBandOnlyVisualResult();
      },
    },
  });

  const result = await extractDocument(await buildState(1));
  const fallback = result.extraction?.metadata.zoneOcrFallback as Record<
    string,
    unknown
  >;
  const zones = fallback.zones as Array<Record<string, unknown>>;
  const signatureZone = zones.find(
    (zone) => zone.candidateId === "visual_anchor_payor_region",
  );
  const zoneCalls = calls.filter((call) =>
    call.revision.includes("-zone-signature_block"),
  );
  const visualFallback = (
    result.normalized?.normalizerPayload as Record<string, unknown>
  ).signatureVisualFallback as Record<string, unknown>;

  assert.equal(result.decision?.route, "continue");
  assert.equal(visualCalls, 1);
  assert.equal(zoneCalls.length, 1);
  assert.match(
    String(zoneCalls[0]?.revision),
    /-zone-signature_block-candidate-visual_anchor_payor_region$/u,
  );
  assert.equal(signatureZone?.candidateSource, "visual_anchor");
  assert.equal(result.normalized?.printedName, "SHARON ROSE Z. MEDINA");
  assert.equal(result.normalized?.signatoryTitle, "Manager Accounting");
  assert.equal(result.normalized?.signatoryTin, "201308097000");
  assert.equal(result.normalized?.signaturePresent, undefined);
  assert.equal(result.normalized?.signature, undefined);
  assert.equal(visualFallback.status, "not_detected");
  assert.equal(visualFallback.promoted, false);
});

test("extractDocument keeps fixed signature candidates when visual detection is unavailable", async () => {
  const calls: OcrCall[] = [];
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    zoneOcrConfig: defaultZoneOcrConfig(),
    annotationOverridesByPage: {
      1: {
        printedName: null,
        signatoryTitle: null,
        signatoryTin: null,
        signaturePresent: null,
      },
    },
    zoneTextByCandidateId: {
      payor_left_lower: "",
      payor_left_upper: "",
      payor_wide_lower:
        "LEON D. SARALDE Finance Manager (901-327-847-000)\nSignature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent",
    },
    zoneAnnotationById: {
      signature_block: buildCertificateAnnotation("Ignored", null, {
        printedName: "LEON D. SARALDE",
        signatoryTitle: "Finance Manager",
        signatoryTin: "901-327-847-000",
      }),
    },
  });

  const result = await extractDocument(await buildState(1));
  const zoneCalls = calls.filter((call) =>
    call.revision.includes("-zone-signature_block"),
  );

  assert.equal(zoneCalls.length, 3);
  assert.match(
    String(zoneCalls[0]?.revision),
    /-zone-signature_block-candidate-payor_left_lower$/u,
  );
  assert.equal(result.normalized?.printedName, "LEON D. SARALDE");
});

test("extractDocument keeps printed name missing when visual-anchored signer OCR is unusable", async () => {
  const calls: OcrCall[] = [];
  let visualCalls = 0;
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    signaturePresent: false,
    zoneOcrConfig: defaultZoneOcrConfig(),
    annotationOverridesByPage: {
      1: {
        printedName: null,
        signatoryTitle: null,
        signatoryTin: null,
        signaturePresent: null,
      },
    },
    zoneTextByCandidateId: {
      visual_anchor_payor_region: "",
      visual_anchor_payor_upper_band:
        "signature over printed name of payee payee s authorized indicate title designation",
      payor_left_upper:
        "note the bir data privacy is in the bir website www bir gov ph",
    },
    signatureVisualDetector: {
      async detect() {
        visualCalls += 1;
        return buildDetectedSignatureVisualResult();
      },
    },
  });

  const result = await extractDocument(await buildState(1));
  const fallback = result.extraction?.metadata.zoneOcrFallback as Record<
    string,
    unknown
  >;
  const discardedZones = fallback.discardedZones as Array<
    Record<string, unknown>
  >;
  const zoneCalls = calls.filter((call) =>
    call.revision.includes("-zone-signature_block"),
  );

  assert.equal(visualCalls, 1);
  assert.equal(zoneCalls.length, 3);
  assert.equal(discardedZones.length, 3);
  assert.equal(result.normalized?.printedName, undefined);
  assert.equal(result.normalized?.signaturePresent, true);
  assert.equal(result.normalized?.signature, true);
});

test("extractDocument still promotes visible signatures after zone-enriched normalization", async () => {
  const calls: OcrCall[] = [];
  let visualCalls = 0;
  const mainText = completeCertificateText.slice(
    0,
    completeCertificateText.indexOf("LILIAN D. SARALDE"),
  );
  const extractDocument = buildNode([mainText], {
    calls,
    signaturePresent: false,
    zoneOcrConfig: defaultZoneOcrConfig(),
    zoneTextById: {
      signature_block: `
        LILIAN D. SARALDE Finance Manager (901-327-847-000)
        Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent
      `,
    },
    signatureVisualDetector: {
      async detect() {
        visualCalls += 1;
        return {
          status: "detected",
          signaturePresent: true,
          confidence: 0.88,
          metrics: {
            darkPixelCount: 1400,
            candidateCount: 1,
            largestCandidateArea: 240,
            largestCandidateWidth: 140,
            largestCandidateHeight: 30,
            analysisWidth: 400,
            analysisHeight: 80,
          },
          render: {
            dpi: 300,
            elapsedMs: 5,
            cropPixels: { x: 0, y: 0, width: 400, height: 120 },
            pagePixels: { width: 800, height: 1000 },
          },
        };
      },
    },
  });

  const result = await extractDocument(await buildState(1));

  assert.equal(calls.length, 2);
  assert.equal(visualCalls, 1);
  assert.equal(result.normalized?.signaturePresent, true);
  assert.equal(result.normalized?.signature, true);
  assert.equal(
    (
      (result.normalized?.normalizerPayload as Record<string, unknown>)
        .signatureVisualFallback as Record<string, unknown>
    ).promoted,
    true,
  );
});

test("extractDocument errors when no certificate pages are detected", async () => {
  const extractDocument = buildNode([memoText, memoText]);
  const result = await extractDocument(await buildState(2));

  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "no_certificate_pages_detected",
  ]);
});

test("extractDocument routes multiple certificate page errors after one annotated OCR pass per page", async () => {
  const calls: Array<{ revision: string; mimeType: string; content: Buffer }> =
    [];
  const extractDocument = buildNode(
    [certificateText, memoText, certificateText],
    { calls },
  );
  const result = await extractDocument(await buildState(3));

  assert.equal(result.decision?.route, "error");
  assert.equal(result.decision?.terminalStatus, "Error");
  assert.equal(result.decision?.phase, "extract");
  assert.equal(calls.length, 3);
  assert.deepEqual(result.decision?.reasonCodes, [
    "multiple_certificate_pages_detected",
  ]);
  assert.equal(result.extraction?.parsedText, certificateText);
  assert.equal(result.normalized?.payeeName, "Payee Page 1");
  assert.equal(result.pages?.[0]?.normalized?.payeeName, "Payee Page 1");
  assert.equal(result.pages?.[2]?.normalized?.payeeName, "Payee Page 3");
  assert.deepEqual(result.batchSummary?.certificatePageNumbers, [1, 3]);
  assert.deepEqual(result.batchSummary?.ignoredPageNumbers, [2]);
  assert.deepEqual(result.batchSummary?.failedPageNumbers, [1, 3]);
  assert.equal(
    result.validation?.checks[0]?.code,
    "MULTIPLE_CERTIFICATE_PAGES_DETECTED",
  );
});

test("extractDocument errors when a certificate OCR response has no document annotation", async () => {
  const calls: Array<{ revision: string; mimeType: string; content: Buffer }> =
    [];
  const extractDocument = buildNode([certificateText], {
    calls,
    omitAnnotationPages: [1],
  });

  const result = await extractDocument(await buildState(1));

  assert.equal(calls.length, 1);
  assert.equal(result.decision?.route, "error");
  assert.deepEqual(result.decision?.reasonCodes, [
    "missing_document_annotation",
  ]);
  assert.equal(
    result.validation?.checks[0]?.code,
    "MISSING_DOCUMENT_ANNOTATION",
  );
});

test("extractDocument keeps source page bytes for downstream persistence", async () => {
  const calls: Array<{ revision: string; mimeType: string; content: Buffer }> =
    [];
  const extractDocument = buildNode([certificateText], { calls });

  const result = await extractDocument(await buildState(1));

  assert.equal(result.decision?.route, "continue");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.mimeType, "application/pdf");
  assert.equal(
    Buffer.from(result.pages?.[0]?.sourceContentBase64 ?? "", "base64")
      .subarray(0, 4)
      .toString(),
    "%PDF",
  );
});
