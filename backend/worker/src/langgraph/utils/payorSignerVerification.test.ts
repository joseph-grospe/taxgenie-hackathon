import assert from "node:assert/strict";
import test from "node:test";

import type {
  DocumentExtractionClient,
  DocumentExtractionMetadata,
} from "../services/documentExtractionClient.ts";
import { buildTwoBlockBir2307Fixture } from "../testFixtures/twoBlockBir2307.ts";
import type { EffectiveCertificate } from "../types.ts";
import type { PdfRegionRenderer } from "./pdfRegionRenderer.ts";
import {
  createPdfTextLayerExtractor,
  type PdfTextLayerExtractor,
} from "./pdfTextLayerExtractor.ts";
import {
  createSignatureVisualDetector,
  type SignatureVisualDetectionResult,
} from "./signatureVisualDetector.ts";
import { verifyPayorSigner } from "./payorSignerVerification.ts";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const metadata: DocumentExtractionMetadata = {
  provider: "gemini",
  requestedModel: "gemini-test",
  promptVersion: "bir2307-payor-signer-v1",
  schemaVersion: 1,
  thinkingLevel: "high",
  mediaResolution: "medium",
  startedAt: "2026-07-29T00:00:00.000Z",
  finishedAt: "2026-07-29T00:00:01.000Z",
  latencyMs: 1_000,
  attemptCount: 1,
  usage: {},
};

function certificate(
  signer: Partial<EffectiveCertificate["signer"]> = {},
): EffectiveCertificate {
  return {
    certificateKey: "certificate-1",
    pageNumbers: [1],
    period: {
      start: "2026-04-01",
      end: "2026-06-30",
      monthOfQuarter: "first",
    },
    payee: {
      name: "PAYEE COMPANY",
      tin: "00503166300000",
      address: null,
      zip: null,
    },
    payor: {
      name: "PAYOR COMPANY",
      tin: "0002025240000",
      address: null,
      zip: null,
    },
    taxRows: [],
    primaryAtcCode: null,
    totals: { taxBase: null, taxWithheld: null },
    signer: {
      printedName: "PAYOR SIGNER",
      title: "Finance Manager",
      tin: "901327847000",
      companyName: null,
      signature: {
        present: true,
        confidence: 0.9,
        pageNumber: 1,
        source: "visual_fallback",
      },
      ...signer,
    },
    confidence: {
      period: 1,
      payee: 1,
      payor: 1,
      taxRows: 1,
      signer: 1,
    },
    evidence: {},
    warnings: [],
  };
}

function cropClient(
  result: {
    printedName: string | null;
    title: string | null;
    tin: string | null;
    companyName: string | null;
  },
): DocumentExtractionClient {
  return {
    extract: async () => {
      throw new Error("Whole-document extraction is not used in this test.");
    },
    extractPayorSigner: async () => ({
      result: {
        ...result,
        confidence: 0.95,
        warnings: [],
      },
      metadata,
    }),
  };
}

const renderer: PdfRegionRenderer = {
  render: async () => ({
    content: Buffer.from("synthetic-payor-crop"),
    mimeType: "image/png",
    metadata: {
      renderer: "pdftoppm",
      dpi: 400,
      elapsedMs: 5,
      renderedBytes: 22,
      bounds: { x: 10, y: 10, width: 100, height: 50 },
    },
  }),
};

test("payor signer verification uses the synthetic two-block fixture", async (t) => {
  const pdf = await buildTwoBlockBir2307Fixture();
  const detection = await createSignatureVisualDetector({
    dpi: 400,
    timeoutMs: 60_000,
  }).detect({
    content: pdf,
    sourceFileId: "synthetic-two-block",
    revision: "v1",
    pageNumber: 1,
  });
  const textExtractor = createPdfTextLayerExtractor({ timeoutMs: 60_000 });

  await t.test(
    "embedded payor text confirms all populated fields without a crop call",
    async () => {
      let cropCalls = 0;
      const result = await verifyPayorSigner({
        certificate: certificate(),
        pageContent: pdf,
        pageNumber: 1,
        detection,
        textLayerExtractor: textExtractor,
        regionRenderer: {
          render: async () => {
            cropCalls += 1;
            return renderer.render({
              content: pdf,
              sourceFileId: "synthetic-two-block",
              revision: "v1",
              pageNumber: 1,
              dpi: 400,
              pagePixels: detection.render.pagePixels,
              bounds: detection.structure!.payorSignerWindow!.pixels,
            });
          },
        },
        extractionClient: cropClient({
          printedName: "SHOULD NOT RUN",
          title: null,
          tin: null,
          companyName: null,
        }),
        sourceFileId: "synthetic-two-block",
        revision: "v1",
        logger,
      });

      assert.equal(result.audit.status, "confirmed");
      assert.equal(result.audit.source, "text_layout");
      assert.deepEqual(result.audit.recoveredFields, [
        "printedName",
        "title",
        "tin",
      ]);
      assert.equal(cropCalls, 0);
    },
  );

  await t.test(
    "a lower payee name cannot satisfy a blank payor printed name",
    async () => {
      const blankPayorPdf = await buildTwoBlockBir2307Fixture({
        payorPrintedName: null,
        payorTitle: null,
        payorTin: null,
        payeePrintedName: "LOWER PAYEE SIGNER",
      });
      const blankDetection = await createSignatureVisualDetector({
        dpi: 400,
        timeoutMs: 60_000,
      }).detect({
        content: blankPayorPdf,
        sourceFileId: "synthetic-blank-payor",
        revision: "v1",
        pageNumber: 1,
      });
      const result = await verifyPayorSigner({
        certificate: certificate({
          printedName: "LOWER PAYEE SIGNER",
          title: null,
          tin: null,
          companyName: null,
        }),
        pageContent: blankPayorPdf,
        pageNumber: 1,
        detection: blankDetection,
        textLayerExtractor: textExtractor,
        regionRenderer: renderer,
        extractionClient: cropClient({
          printedName: null,
          title: null,
          tin: null,
          companyName: null,
        }),
        sourceFileId: "synthetic-blank-payor",
        revision: "v1",
        logger,
      });

      assert.equal(result.audit.status, "missing");
      assert.equal(result.audit.source, "gemini_crop");
      assert.equal(result.audit.disagreement, true);
      assert.equal(result.effective.signer.printedName, null);
    },
  );

  await t.test(
    "the crop corrects a whole-document payee name and is authoritative",
    async () => {
      const result = await verifyPayorSigner({
        certificate: certificate({
          printedName: "LOWER PAYEE SIGNER",
          title: "Payee Treasurer",
          tin: "111222333000",
          companyName: "PAYEE COMPANY",
        }),
        pageContent: pdf,
        pageNumber: 1,
        detection,
        textLayerExtractor: textExtractor,
        regionRenderer: renderer,
        extractionClient: cropClient({
          printedName: "PAYOR SIGNER",
          title: null,
          tin: null,
          companyName: null,
        }),
        sourceFileId: "synthetic-two-block",
        revision: "v1",
        logger,
      });

      assert.equal(result.audit.status, "corrected");
      assert.equal(result.audit.source, "gemini_crop");
      assert.deepEqual(result.audit.recoveredFields, ["printedName"]);
      assert.equal(result.effective.signer.printedName, "PAYOR SIGNER");
      assert.equal(result.effective.signer.title, null);
      assert.equal(result.effective.signer.tin, null);
      assert.equal(result.effective.signer.companyName, null);
    },
  );

  await t.test(
    "missing positioned text triggers the adaptive crop verifier",
    async () => {
      let cropCalls = 0;
      const imageOnlyTextExtractor: PdfTextLayerExtractor = {
        extract: async () => ({
          text: "",
          page: { width: 612, height: 792 },
          lines: [],
          metadata: {
            extractor: "pdftotext",
            layout: true,
            positioned: true,
            elapsedMs: 1,
            originalPdfBytes: pdf.byteLength,
            textLength: 0,
          },
        }),
      };
      const result = await verifyPayorSigner({
        certificate: certificate(),
        pageContent: pdf,
        pageNumber: 1,
        detection,
        textLayerExtractor: imageOnlyTextExtractor,
        regionRenderer: {
          render: async (input) => {
            cropCalls += 1;
            return renderer.render(input);
          },
        },
        extractionClient: cropClient({
          printedName: "PAYOR SIGNER",
          title: "Finance Manager",
          tin: "901-327-847-000",
          companyName: null,
        }),
        sourceFileId: "synthetic-image-only",
        revision: "v1",
        logger,
      });

      assert.equal(cropCalls, 1);
      assert.equal(result.audit.status, "confirmed");
      assert.equal(result.audit.source, "gemini_crop");
    },
  );

  await t.test(
    "missing bounds and crop failures clear identity and fail closed",
    async () => {
      const withoutBounds: SignatureVisualDetectionResult = {
        ...detection,
        structure: {
          ...detection.structure!,
          payorSignerWindow: undefined,
        },
      };
      const unverifiable = await verifyPayorSigner({
        certificate: certificate(),
        pageContent: pdf,
        pageNumber: 1,
        detection: withoutBounds,
        textLayerExtractor: textExtractor,
        regionRenderer: renderer,
        extractionClient: cropClient({
          printedName: "PAYOR SIGNER",
          title: null,
          tin: null,
          companyName: null,
        }),
        sourceFileId: "synthetic-no-bounds",
        revision: "v1",
        logger,
      });
      assert.equal(unverifiable.audit.status, "unverifiable");
      assert.equal(
        unverifiable.audit.errorCode,
        "payor_signer_block_unverifiable",
      );
      assert.equal(unverifiable.effective.signer.printedName, null);

      const failed = await verifyPayorSigner({
        certificate: certificate({
          printedName: "LOWER PAYEE SIGNER",
          title: null,
          tin: null,
          companyName: null,
        }),
        pageContent: pdf,
        pageNumber: 1,
        detection,
        textLayerExtractor: textExtractor,
        regionRenderer: {
          render: async () => {
            throw new Error("renderer unavailable");
          },
        },
        extractionClient: cropClient({
          printedName: "PAYOR SIGNER",
          title: null,
          tin: null,
          companyName: null,
        }),
        sourceFileId: "synthetic-render-failure",
        revision: "v1",
        logger,
      });
      assert.equal(failed.audit.status, "failed");
      assert.equal(
        failed.audit.errorCode,
        "payor_signer_verification_failed",
      );
      assert.equal(failed.effective.signer.printedName, null);
    },
  );
});
