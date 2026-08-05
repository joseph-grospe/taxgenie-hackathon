import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import {
  analyzePpmBlankness,
  createPdfBlankPageDetector,
} from "./pdfBlankPageDetector.ts";

function ppm(width: number, height: number, pixels: number[]): Buffer {
  return Buffer.concat([
    Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii"),
    Buffer.from(pixels),
  ]);
}

async function buildPdf(
  draw: (document: PDFDocument) => Promise<void> | void = () => undefined,
): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  await draw(document);
  return Buffer.from(await document.save());
}

test("PPM blankness requires every rendered channel to be pure white", () => {
  assert.deepEqual(
    analyzePpmBlankness(ppm(2, 1, [255, 255, 255, 255, 255, 255])),
    {
      width: 2,
      height: 1,
      nonWhitePixelCount: 0,
    },
  );
  assert.deepEqual(
    analyzePpmBlankness(ppm(2, 1, [255, 255, 255, 255, 255, 254])),
    {
      width: 2,
      height: 1,
      nonWhitePixelCount: 1,
    },
  );
});

test("PPM blankness rejects malformed raster output", () => {
  for (const value of [
    Buffer.from("not-ppm"),
    Buffer.from("P6\n0 1\n255\n"),
    Buffer.from("P6\n1 1\n100\n\x00\x00\x00", "binary"),
    Buffer.from("P6\n1 1\n255\n\xff\xff", "binary"),
  ]) {
    assert.throws(() => analyzePpmBlankness(value));
  }
});

test("blank-page detector accepts white pages and rejects visible content", async (t) => {
  if (spawnSync("pdftoppm", ["-v"]).status !== 0) {
    t.skip("pdftoppm is not installed in this environment");
    return;
  }

  const detector = createPdfBlankPageDetector({ dpi: 72, timeoutMs: 60_000 });
  const cases = [
    {
      name: "blank",
      blank: true,
      content: await buildPdf(),
    },
    {
      name: "text",
      blank: false,
      content: await buildPdf(async (document) => {
        const font = await document.embedFont(StandardFonts.Helvetica);
        document.getPage(0).drawText("visible", {
          x: 20,
          y: 100,
          size: 12,
          font,
          color: rgb(0, 0, 0),
        });
      }),
    },
    {
      name: "vector",
      blank: false,
      content: await buildPdf((document) => {
        document.getPage(0).drawRectangle({
          x: 20,
          y: 20,
          width: 10,
          height: 10,
          color: rgb(0, 0, 0),
        });
      }),
    },
    {
      name: "image",
      blank: false,
      content: await buildPdf(async (document) => {
        const image = await document.embedPng(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==",
            "base64",
          ),
        );
        document.getPage(0).drawImage(image, {
          x: 20,
          y: 20,
          width: 10,
          height: 10,
        });
      }),
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const result = await detector.detect({
        content: entry.content,
        sourceFileId: `source-${entry.name}`,
        revision: "v1",
        pageNumber: 1,
      });
      assert.equal(result.blank, entry.blank);
      assert.equal(result.dpi, 72);
      assert.equal(result.nonWhitePixelCount === 0, entry.blank);
    });
  }
});

test("blank-page detector rejects malformed renderer output", async () => {
  const detector = createPdfBlankPageDetector(
    { dpi: 72, timeoutMs: 1_000 },
    {
      runCommand: async (_command, args) => {
        const outputPrefix = args.at(-1);
        assert.ok(outputPrefix);
        await writeFile(`${outputPrefix}.ppm`, "malformed");
      },
    },
  );

  await assert.rejects(
    detector.detect({
      content: await buildPdf(),
      sourceFileId: "malformed-render",
      revision: "v1",
      pageNumber: 1,
    }),
    /Unsupported PPM format/iu,
  );
});

test("blank-page detector surfaces renderer timeouts", async () => {
  const detector = createPdfBlankPageDetector(
    { dpi: 72, timeoutMs: 1 },
    {
      runCommand: async () => {
        throw new Error("renderer timed out");
      },
    },
  );

  await assert.rejects(
    detector.detect({
      content: await buildPdf(),
      sourceFileId: "timeout-render",
      revision: "v1",
      pageNumber: 1,
    }),
    /renderer timed out/iu,
  );
});

test("blank-page detector surfaces a missing pdftoppm executable", async () => {
  const detector = createPdfBlankPageDetector({
    command: "taxtrack-missing-pdftoppm",
    dpi: 72,
    timeoutMs: 1_000,
  });

  await assert.rejects(
    detector.detect({
      content: await buildPdf(),
      sourceFileId: "missing-renderer",
      revision: "v1",
      pageNumber: 1,
    }),
    /Blank-page detection failed/iu,
  );
});
