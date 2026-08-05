import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

import { buildTwoBlockBir2307Fixture } from "../testFixtures/twoBlockBir2307.ts";
import { createPdfRegionRenderer } from "./pdfRegionRenderer.ts";
import { createSignatureVisualDetector } from "./signatureVisualDetector.ts";

function pngDimensions(content: Buffer) {
  assert.equal(content.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: content.readUInt32BE(16),
    height: content.readUInt32BE(20),
  };
}

test("payor region renderer crops only the detector-provided bounds in memory", async (t) => {
  if (spawnSync("pdftoppm", ["-v"]).status !== 0) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const content = await buildTwoBlockBir2307Fixture({
    payorPrintedName: null,
    payeePrintedName: "LOWER PAYEE SIGNER",
  });
  const detection = await createSignatureVisualDetector({
    dpi: 200,
    timeoutMs: 60_000,
  }).detect({
    content,
    sourceFileId: "synthetic-crop",
    revision: "v1",
    pageNumber: 1,
  });
  const bounds = detection.structure?.payorSignerWindow?.pixels;
  assert.ok(bounds);
  const rendered = await createPdfRegionRenderer({
    timeoutMs: 60_000,
  }).render({
    content,
    sourceFileId: "synthetic-crop",
    revision: "v1",
    pageNumber: 1,
    dpi: detection.render.dpi,
    pagePixels:
      detection.render.originalPagePixels ?? detection.render.pagePixels,
    bounds,
  });

  assert.equal(rendered.mimeType, "image/png");
  assert.deepEqual(pngDimensions(rendered.content), {
    width: rendered.metadata.bounds.width,
    height: rendered.metadata.bounds.height,
  });
  assert.ok(rendered.content.byteLength > 100);
  assert.equal("path" in rendered.metadata, false);
});
