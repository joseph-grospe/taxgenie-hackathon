import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

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

function hasPdftoppm(): boolean {
  const result = spawnSync("pdftoppm", ["-v"], { encoding: "utf8" });
  return result.status === 0;
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
