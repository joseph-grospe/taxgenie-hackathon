import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";

import { createPdfZoneRenderer } from "./pdfZoneRenderer.ts";
import { BIR_2307_ZONES } from "./zoneOcr.ts";

async function buildPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("BIR Form No. 2307", {
    x: 48,
    y: 720,
    size: 18,
    font,
  });

  return Buffer.from(await document.save());
}

async function buildRotatedPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 1008]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("JOHN LOUIE T. TAN", {
    x: 230,
    y: 150,
    size: 18,
    font,
  });
  page.setRotation(degrees(270));

  return Buffer.from(await document.save());
}

function hasPdftoppm(): boolean {
  const result = spawnSync("pdftoppm", ["-v"], { encoding: "utf8" });
  return result.status === 0;
}

function readPngDimensions(content: Buffer) {
  assert.deepEqual([...content.subarray(0, 8)], [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);

  return {
    width: content.readUInt32BE(16),
    height: content.readUInt32BE(20),
  };
}

test("pdf zone renderer renders a crop to a non-empty PNG", async (t) => {
  if (!hasPdftoppm()) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const pdf = await buildPdf();
  const renderer = createPdfZoneRenderer({ dpi: 300, timeoutMs: 60000 });
  const zone = BIR_2307_ZONES.find((item) => item.id === "header_period");
  assert.ok(zone);

  const result = await renderer.render({
    content: pdf,
    zone,
    sourceFileId: "source-1",
    revision: "v1-page-1-zone-header_period",
    pageNumber: 1,
  });

  assert.equal(result.mimeType, "image/png");
  assert.deepEqual([...result.content.subarray(0, 8)], [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);
  assert.equal(result.metadata.zoneId, "header_period");
  assert.equal(result.metadata.renderDpi, 300);
  assert.equal(result.metadata.originalPdfBytes, pdf.byteLength);
  assert.equal(result.metadata.renderedPngBytes, result.content.byteLength);
  assert.ok(result.metadata.cropPixels.width > 0);
  assert.ok(result.metadata.cropPixels.height > 0);
});

test("pdf zone renderer normalizes rotated pages before applying crop coordinates", async (t) => {
  if (!hasPdftoppm()) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const pdf = await buildRotatedPdf();
  const renderer = createPdfZoneRenderer({ dpi: 300, timeoutMs: 60000 });
  const result = await renderer.render({
    content: pdf,
    zone: {
      id: "signature_block",
      label: "Rotated payor signer band",
      relativeRect: { left: 0.06, top: 0.52, width: 0.88, height: 0.28 },
    },
    sourceFileId: "source-rotated",
    revision: "v1-page-1-zone-signature_block",
    pageNumber: 1,
  });

  const dimensions = readPngDimensions(result.content);

  assert.equal(result.metadata.pageRotationDegrees, 270);
  assert.equal(result.metadata.rotationNormalized, true);
  assert.ok(result.metadata.renderedPdfBytes > 0);
  assert.ok(result.metadata.pagePixels.width < result.metadata.pagePixels.height);
  assert.equal(dimensions.width, result.metadata.cropPixels.width);
  assert.equal(dimensions.height, result.metadata.cropPixels.height);
});
