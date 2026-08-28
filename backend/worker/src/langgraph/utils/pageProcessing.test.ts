import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { selectPdfPages, splitPdfPages } from "./pageProcessing.ts";

async function buildSourcePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  document.addPage([200, 200]);
  return Buffer.from(await document.save());
}

test("generated page PDFs use TaxGenie creator and producer metadata", async () => {
  const source = await buildSourcePdf();
  const splitPages = await splitPdfPages(source);
  const selectedPages = await selectPdfPages(source, [2]);
  const outputs = [...splitPages.map((page) => page.content), selectedPages];

  for (const output of outputs) {
    const document = await PDFDocument.load(output, { updateMetadata: false });
    assert.equal(document.getCreator(), "TaxGenie");
    assert.equal(document.getProducer(), "TaxGenie");
  }
});
