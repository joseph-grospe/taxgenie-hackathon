import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { buildTwoBlockBir2307Fixture } from "../testFixtures/twoBlockBir2307.ts";
import { createPdfTextLayerExtractor } from "./pdfTextLayerExtractor.ts";
import {
  analyzeSignatureRaster,
  createSignatureVisualDetector,
} from "./signatureVisualDetector.ts";

function hasPdftoppm(): boolean {
  const result = spawnSync("pdftoppm", ["-v"], { encoding: "utf8" });
  return result.status === 0;
}

type SignatureFixtureStyle = "none" | "broad" | "faint" | "overprinted";

async function buildPayorSignatureFixture(options: {
  signed?: boolean;
  style?: SignatureFixtureStyle;
  rotationDegrees?: 90 | 180 | 270;
}) {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);
  const style: SignatureFixtureStyle =
    options.style ?? (options.signed ? "broad" : "none");

  page.drawText("BIR Form No. 2307", {
    x: 52,
    y: 705,
    size: 14,
    font,
    color: black,
  });
  page.drawText("Certificate of Creditable Tax Withheld at Source", {
    x: 190,
    y: 705,
    size: 13,
    font,
    color: black,
  });
  page.drawLine({
    start: { x: 36, y: 724 },
    end: { x: 576, y: 724 },
    thickness: 0.7,
    color: black,
  });
  page.drawLine({
    start: { x: 36, y: 40 },
    end: { x: 576, y: 40 },
    thickness: 0.7,
    color: black,
  });
  page.drawLine({
    start: { x: 36, y: 40 },
    end: { x: 36, y: 724 },
    thickness: 0.7,
    color: black,
  });
  page.drawLine({
    start: { x: 576, y: 40 },
    end: { x: 576, y: 724 },
    thickness: 0.7,
    color: black,
  });
  page.drawLine({
    start: { x: 36, y: 620 },
    end: { x: 576, y: 620 },
    thickness: 0.7,
    color: black,
  });
  page.drawLine({
    start: { x: 36, y: 306 },
    end: { x: 576, y: 306 },
    thickness: 0.7,
    color: black,
  });

  page.drawText(
    "We declare under the penalties of perjury that this certificate has been made in good faith.",
    {
      x: 36,
      y: 178,
      size: 8,
      font,
      color: black,
    },
  );
  page.drawText("RANDY R. ZAPANTA", {
    x: 95,
    y: 128,
    size: 12,
    font,
    color: black,
  });
  page.drawText("FSD Manager", {
    x: 310,
    y: 128,
    size: 12,
    font,
    color: black,
  });
  page.drawText("465-263-117", {
    x: 470,
    y: 128,
    size: 12,
    font,
    color: black,
  });
  page.drawText(
    "Signature over Printed Name of Payor/Payor's Authorized Representative/Tax Agent",
    {
      x: 145,
      y: 96,
      size: 8,
      font,
      color: black,
    },
  );

  page.drawLine({
    start: { x: 36, y: 116 },
    end: { x: 576, y: 116 },
    thickness: 0.7,
    color: black,
  });
  page.drawLine({
    start: { x: 36, y: 88 },
    end: { x: 576, y: 88 },
    thickness: 0.7,
    color: black,
  });

  if (style === "broad") {
    page.drawLine({
      start: { x: 95, y: 147 },
      end: { x: 145, y: 120 },
      thickness: 1.6,
      color: black,
    });
    page.drawLine({
      start: { x: 145, y: 120 },
      end: { x: 205, y: 148 },
      thickness: 1.6,
      color: black,
    });
    page.drawLine({
      start: { x: 205, y: 148 },
      end: { x: 250, y: 116 },
      thickness: 1.6,
      color: black,
    });
    page.drawLine({
      start: { x: 120, y: 135 },
      end: { x: 275, y: 135 },
      thickness: 1.1,
      color: black,
    });
  }
  if (style === "faint") {
    const gray = rgb(0.62, 0.62, 0.62);
    page.drawLine({
      start: { x: 222, y: 154 },
      end: { x: 242, y: 134 },
      thickness: 0.7,
      color: gray,
    });
    page.drawLine({
      start: { x: 242, y: 134 },
      end: { x: 270, y: 151 },
      thickness: 0.7,
      color: gray,
    });
    page.drawLine({
      start: { x: 270, y: 151 },
      end: { x: 305, y: 136 },
      thickness: 0.7,
      color: gray,
    });
    page.drawLine({
      start: { x: 305, y: 136 },
      end: { x: 335, y: 150 },
      thickness: 0.7,
      color: gray,
    });
  }
  if (style === "overprinted") {
    page.drawLine({
      start: { x: 168, y: 158 },
      end: { x: 182, y: 116 },
      thickness: 1.2,
      color: black,
    });
    page.drawLine({
      start: { x: 186, y: 158 },
      end: { x: 205, y: 114 },
      thickness: 1.2,
      color: black,
    });
    page.drawLine({
      start: { x: 205, y: 114 },
      end: { x: 232, y: 156 },
      thickness: 1.2,
      color: black,
    });
    page.drawLine({
      start: { x: 232, y: 156 },
      end: { x: 250, y: 118 },
      thickness: 1.2,
      color: black,
    });
  }

  if (options.rotationDegrees) {
    page.setRotation(degrees(options.rotationDegrees));
  }

  return Buffer.from(await document.save());
}

type TestRaster = Parameters<typeof analyzeSignatureRaster>[0];

function buildWhiteRaster(width: number, height: number): TestRaster {
  return {
    width,
    height,
    data: Buffer.alloc(width * height * 3, 255),
  };
}

function setPixel(raster: TestRaster, x: number, y: number, value: number) {
  if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) {
    return;
  }

  const offset = (y * raster.width + x) * 3;
  raster.data[offset] = value;
  raster.data[offset + 1] = value;
  raster.data[offset + 2] = value;
}

function setRgbPixel(
  raster: TestRaster,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
) {
  if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) {
    return;
  }

  const offset = (y * raster.width + x) * 3;
  raster.data[offset] = red;
  raster.data[offset + 1] = green;
  raster.data[offset + 2] = blue;
}

function fillRect(
  raster: TestRaster,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      setPixel(raster, x, y, 0);
    }
  }
}

function drawHorizontalRule(raster: TestRaster, y: number) {
  fillRect(raster, 18, y, raster.width - 36, 3);
}

function drawVerticalRule(
  raster: TestRaster,
  x: number,
  top: number,
  bottom: number,
) {
  fillRect(raster, x, top, 3, Math.max(1, bottom - top + 1));
}

function drawThickLine(
  raster: TestRaster,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  let x = fromX;
  let y = fromY;
  const dx = Math.abs(toX - fromX);
  const sx = fromX < toX ? 1 : -1;
  const dy = -Math.abs(toY - fromY);
  const sy = fromY < toY ? 1 : -1;
  let error = dx + dy;

  while (true) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        setPixel(raster, x + offsetX, y + offsetY, 0);
      }
    }

    if (x === toX && y === toY) {
      break;
    }

    const doubledError = error * 2;
    if (doubledError >= dy) {
      error += dy;
      x += sx;
    }
    if (doubledError <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function drawColoredThickLine(
  raster: TestRaster,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: { red: number; green: number; blue: number },
) {
  let x = fromX;
  let y = fromY;
  const dx = Math.abs(toX - fromX);
  const sx = fromX < toX ? 1 : -1;
  const dy = -Math.abs(toY - fromY);
  const sy = fromY < toY ? 1 : -1;
  let error = dx + dy;

  while (true) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        setRgbPixel(
          raster,
          x + offsetX,
          y + offsetY,
          color.red,
          color.green,
          color.blue,
        );
      }
    }

    if (x === toX && y === toY) {
      break;
    }

    const doubledError = error * 2;
    if (doubledError >= dy) {
      error += dy;
      x += sx;
    }
    if (doubledError <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function buildStructuredSignatureRaster(options: {
  height?: number;
  payorSignature?: boolean;
  lowerSignature?: boolean;
}): TestRaster {
  const height = options.height ?? 300;
  const raster = buildWhiteRaster(460, height);
  const signerLineY = Math.round(height * 0.42);
  const gridTopY = Math.round(height * 0.56);
  const gridBottomY = Math.round(height * 0.76);

  drawHorizontalRule(raster, signerLineY);
  drawHorizontalRule(raster, gridTopY);
  drawHorizontalRule(raster, gridBottomY);

  for (const x of [24, 88, 150, 210, 268, 326, 382, 432]) {
    drawVerticalRule(raster, x, gridTopY, gridBottomY);
  }

  if (options.payorSignature) {
    const signatureTop = signerLineY - Math.round(height * 0.12);
    drawThickLine(raster, 98, signatureTop + 22, 140, signatureTop + 3);
    drawThickLine(raster, 140, signatureTop + 3, 198, signatureTop + 26);
    drawThickLine(raster, 198, signatureTop + 26, 274, signatureTop + 8);
  }

  if (options.lowerSignature) {
    const lowerTop = gridBottomY + Math.round(height * 0.08);
    drawThickLine(raster, 110, lowerTop + 18, 154, lowerTop);
    drawThickLine(raster, 154, lowerTop, 220, lowerTop + 24);
    drawThickLine(raster, 220, lowerTop + 24, 302, lowerTop + 6);
  }

  return raster;
}

function buildSignatureRasterWithUpperTableGrid(): TestRaster {
  const raster = buildWhiteRaster(460, 620);

  for (const y of [160, 200, 240, 280]) {
    drawHorizontalRule(raster, y);
  }
  for (const x of [24, 88, 150, 210, 268, 326, 382, 432]) {
    drawVerticalRule(raster, x, 160, 280);
  }

  const signerLineY = 338;
  const gridTopY = 390;
  const gridBottomY = 470;
  drawHorizontalRule(raster, signerLineY);
  drawHorizontalRule(raster, gridTopY);
  drawHorizontalRule(raster, gridBottomY);
  for (const x of [24, 88, 150, 210, 268, 326, 382, 432]) {
    drawVerticalRule(raster, x, gridTopY, gridBottomY);
  }

  drawThickLine(raster, 120, 312, 158, 284);
  drawThickLine(raster, 158, 284, 206, 326);
  drawThickLine(raster, 206, 326, 262, 296);
  drawThickLine(raster, 262, 296, 314, 330);

  return raster;
}

function buildSignatureRasterWithDeclarationGridBeforeSigner(): TestRaster {
  const raster = buildWhiteRaster(460, 620);

  drawHorizontalRule(raster, 260);
  drawHorizontalRule(raster, 304);
  drawHorizontalRule(raster, 374);
  for (const x of [24, 88, 150, 210, 268, 326, 382, 432]) {
    drawVerticalRule(raster, x, 304, 374);
  }

  drawHorizontalRule(raster, 430);
  drawHorizontalRule(raster, 520);
  for (const x of [24, 88, 150, 210, 268, 326, 382, 432]) {
    drawVerticalRule(raster, x, 430, 520);
  }

  drawThickLine(raster, 178, 408, 192, 328);
  drawThickLine(raster, 216, 404, 224, 322);
  drawThickLine(raster, 224, 322, 254, 408);

  return raster;
}

function buildOverprintedSignerInkRaster(): TestRaster {
  const height = 360;
  const raster = buildStructuredSignatureRaster({ height });
  const signerLineY = Math.round(height * 0.42);

  for (let index = 0; index < 12; index += 1) {
    fillRect(raster, 112 + index * 13, signerLineY - 16, 7, 10);
    if (index % 3 !== 0) {
      fillRect(raster, 115 + index * 13, signerLineY - 5, 8, 3);
    }
  }

  drawThickLine(raster, 162, signerLineY - 74, 172, signerLineY - 18);
  drawThickLine(raster, 172, signerLineY - 18, 202, signerLineY - 70);
  drawThickLine(raster, 202, signerLineY - 70, 220, signerLineY - 16);
  drawThickLine(raster, 220, signerLineY - 16, 252, signerLineY - 58);
  drawThickLine(raster, 152, signerLineY - 36, 286, signerLineY - 32);

  return raster;
}

function buildBlueLowerSignerInkRaster(): TestRaster {
  const raster = buildWhiteRaster(460, 320);
  const ink = { red: 210, green: 220, blue: 242 };

  drawColoredThickLine(raster, 188, 208, 206, 170, ink);
  drawColoredThickLine(raster, 206, 170, 242, 214, ink);
  drawColoredThickLine(raster, 242, 214, 286, 184, ink);
  drawColoredThickLine(raster, 214, 206, 306, 202, ink);

  return raster;
}

test("analyzeSignatureRaster identifies DANECO-style upper payor strip strokes", () => {
  const raster = buildStructuredSignatureRaster({ payorSignature: true });

  const result = analyzeSignatureRaster(raster);

  assert.equal(result.signaturePresent, true);
  assert.ok(result.metrics.candidateCount >= 1);
  assert.ok(result.metrics.largestCandidateWidth >= 70);
});

test("analyzeSignatureRaster identifies overprinted signer ink above printed text", () => {
  const raster = buildOverprintedSignerInkRaster();

  const result = analyzeSignatureRaster(raster);

  assert.equal(result.signaturePresent, true);
  assert.ok(result.metrics.candidateCount >= 1);
});

test("analyzeSignatureRaster identifies blue lower signer ink", () => {
  const raster = buildBlueLowerSignerInkRaster();

  const result = analyzeSignatureRaster(raster);

  assert.equal(result.signaturePresent, true);
  assert.ok(result.metrics.candidateCount >= 1);
});

test("analyzeSignatureRaster ignores signature-like marks in the lower payee section", () => {
  const raster = buildStructuredSignatureRaster({ lowerSignature: true });

  const result = analyzeSignatureRaster(raster);

  assert.equal(result.signaturePresent, false);
  assert.equal(result.metrics.candidateCount, 0);
});

test("analyzeSignatureRaster reports a visible payor signer band without a signature mark", () => {
  const raster = buildStructuredSignatureRaster({});

  const result = analyzeSignatureRaster(raster);

  assert.equal(result.signaturePresent, false);
  assert.equal(result.metrics.candidateCount, 0);
  assert.equal(result.structure.payorSignerBandVisible, true);
  assert.equal(result.structure.structuredWindowCount, 1);
});

test("analyzeSignatureRaster prefers lower payor signer band over upper table grid", () => {
  const raster = buildSignatureRasterWithUpperTableGrid();

  const result = analyzeSignatureRaster(raster);

  assert.equal(result.signaturePresent, true);
  assert.ok(result.metrics.candidateCount >= 1);
  assert.ok(result.metrics.analysisHeight > 120);
});

test("analyzeSignatureRaster skips declaration grid before the payor signer row", () => {
  const raster = buildSignatureRasterWithDeclarationGridBeforeSigner();

  const result = analyzeSignatureRaster(raster);

  assert.equal(result.signaturePresent, true);
  assert.ok(result.metrics.candidateCount >= 1);
});

test("analyzeSignatureRaster uses structure anchors on taller scanned forms", () => {
  const raster = buildStructuredSignatureRaster({
    height: 460,
    payorSignature: true,
  });

  const result = analyzeSignatureRaster(raster);

  assert.equal(result.signaturePresent, true);
  assert.ok(result.metrics.candidateCount >= 1);
});

test("signature visual detector identifies handwritten-style payor signature strokes", async (t) => {
  if (!hasPdftoppm()) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const detector = createSignatureVisualDetector({
    dpi: 200,
    timeoutMs: 60000,
  });
  const result = await detector.detect({
    content: await buildPayorSignatureFixture({ signed: true }),
    sourceFileId: "source-1",
    revision: "v1-page-1",
    pageNumber: 1,
  });

  assert.equal(result.status, "detected");
  assert.equal(result.signaturePresent, true);
  assert.ok(result.metrics.candidateCount >= 1);
});

test("signature visual detector does not treat printed signer text alone as signed", async (t) => {
  if (!hasPdftoppm()) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const detector = createSignatureVisualDetector({
    dpi: 200,
    timeoutMs: 60000,
  });
  const result = await detector.detect({
    content: await buildPayorSignatureFixture({ signed: false }),
    sourceFileId: "source-1",
    revision: "v1-page-1",
    pageNumber: 1,
  });

  assert.equal(result.status, "not_detected");
  assert.equal(result.signaturePresent, false);
  assert.equal(result.metrics.candidateCount, 0);
});

test("signature visual detector identifies faint cursive payor signature strokes", async (t) => {
  if (!hasPdftoppm()) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const detector = createSignatureVisualDetector({
    dpi: 200,
    timeoutMs: 60000,
  });
  const result = await detector.detect({
    content: await buildPayorSignatureFixture({ style: "faint" }),
    sourceFileId: "source-1",
    revision: "v1-page-1",
    pageNumber: 1,
  });

  assert.equal(result.status, "detected");
  assert.equal(result.signaturePresent, true);
  assert.ok(result.metrics.candidateCount >= 1);
});

test("signature visual detector normalizes rotated certificate renders before analysis", async (t) => {
  if (!hasPdftoppm()) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const detector = createSignatureVisualDetector({
    dpi: 200,
    timeoutMs: 60000,
  });
  const result = await detector.detect({
    content: await buildPayorSignatureFixture({
      style: "overprinted",
      rotationDegrees: 270,
    }),
    sourceFileId: "source-1",
    revision: "v1-page-1",
    pageNumber: 1,
  });

  assert.equal(result.render.rotationApplied, "clockwise_90");
  assert.ok(result.render.pagePixels.width < result.render.pagePixels.height);
  assert.ok(
    (result.render.originalPagePixels?.width ?? 0) >
      (result.render.originalPagePixels?.height ?? Number.POSITIVE_INFINITY),
  );
  assert.equal(result.status, "detected");
  assert.equal(result.signaturePresent, true);
});

test("signature visual detector identifies narrow overprinted payor signature strokes", async (t) => {
  if (!hasPdftoppm()) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const detector = createSignatureVisualDetector({
    dpi: 200,
    timeoutMs: 60000,
  });
  const result = await detector.detect({
    content: await buildPayorSignatureFixture({ style: "overprinted" }),
    sourceFileId: "source-1",
    revision: "v1-page-1",
    pageNumber: 1,
  });

  assert.equal(result.status, "detected");
  assert.equal(result.signaturePresent, true);
  assert.ok(result.metrics.candidateCount >= 1);
});

test("payor signer bounds exclude the lower payee block across page layouts", async (t) => {
  if (!hasPdftoppm()) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const detector = createSignatureVisualDetector({
    dpi: 200,
    timeoutMs: 60_000,
  });
  const textExtractor = createPdfTextLayerExtractor({ timeoutMs: 60_000 });
  const scenarios: Array<{
    name: string;
    pageSize: "letter" | "a4" | "tall";
    rotationDegrees?: 90 | 270;
    stackedPayorIdentity?: boolean;
  }> = [
    { name: "letter", pageSize: "letter" },
    { name: "A4", pageSize: "a4" },
    { name: "tall scan-shaped", pageSize: "tall" },
    {
      name: "stacked payor identity",
      pageSize: "letter",
      stackedPayorIdentity: true,
    },
    { name: "A4 rotated 90", pageSize: "a4", rotationDegrees: 90 },
    { name: "A4 rotated 270", pageSize: "a4", rotationDegrees: 270 },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const content = await buildTwoBlockBir2307Fixture(scenario);
      const [detection, textLayer] = await Promise.all([
        detector.detect({
          content,
          sourceFileId: `synthetic-${scenario.name}`,
          revision: "v1",
          pageNumber: 1,
        }),
        textExtractor.extract({
          content,
          sourceFileId: `synthetic-${scenario.name}`,
          revision: "v1",
          pageNumber: 1,
        }),
      ]);
      const bounds = detection.structure?.payorSignerWindow?.normalized;
      assert.ok(bounds);
      assert.ok(bounds.left >= 0 && bounds.top >= 0);
      assert.ok(bounds.left + bounds.width <= 1.001);
      assert.ok(bounds.top + bounds.height <= 1.001);
      assert.equal(detection.status, "detected");

      const lineInside = (text: string) => {
        const line = textLayer.lines?.find((entry) => entry.text === text);
        assert.ok(line);
        assert.ok(textLayer.page);
        const centerX =
          (line.bounds.left + line.bounds.right) / (2 * textLayer.page.width);
        const centerY =
          (line.bounds.top + line.bounds.bottom) / (2 * textLayer.page.height);
        return (
          centerX >= bounds.left &&
          centerX <= bounds.left + bounds.width &&
          centerY >= bounds.top &&
          centerY <= bounds.top + bounds.height
        );
      };
      assert.equal(lineInside("PAYOR SIGNER"), true);
      assert.equal(lineInside("Finance Manager"), true);
      assert.equal(lineInside("901-327-847-000"), true);
      assert.equal(lineInside("PAYEE SIGNER"), false);
    });
  }
});
