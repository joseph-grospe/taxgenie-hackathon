import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

import { buildTwoBlockBir2307Fixture } from "../testFixtures/twoBlockBir2307.ts";
import {
  createPdfTextLayerExtractor,
  parsePositionedPdfText,
} from "./pdfTextLayerExtractor.ts";

test("positioned PDF text parser preserves line bounds and decodes entities", () => {
  const parsed = parsePositionedPdfText(`
    <doc>
      <page width="612" height="792">
        <flow><block>
          <line xMin="40" yMin="600" xMax="240" yMax="620">
            <word xMin="40" yMin="600" xMax="90" yMax="620">PAYOR</word>
            <word xMin="95" yMin="600" xMax="160" yMax="620">O&apos;NEIL</word>
          </line>
        </block></flow>
      </page>
    </doc>
  `);

  assert.deepEqual(parsed.page, { width: 612, height: 792 });
  assert.deepEqual(parsed.lines, [
    {
      text: "PAYOR O'NEIL",
      bounds: { left: 40, top: 600, right: 240, bottom: 620 },
    },
  ]);
});

test("positioned PDF text uses display dimensions for rotated pages", async (t) => {
  if (spawnSync("pdftotext", ["-v"]).status !== 0) {
    t.skip("pdftotext is not installed in this environment");
    return;
  }

  const content = await buildTwoBlockBir2307Fixture({
    pageSize: "a4",
    rotationDegrees: 90,
  });
  const result = await createPdfTextLayerExtractor({
    timeoutMs: 60_000,
  }).extract({
    content,
    sourceFileId: "synthetic-rotated",
    revision: "v1",
    pageNumber: 1,
  });

  assert.ok(result.page);
  assert.ok(result.page.width > result.page.height);
  assert.ok(result.lines?.some((line) => line.text === "PAYOR SIGNER"));
  assert.equal(result.metadata.positioned, true);
});
