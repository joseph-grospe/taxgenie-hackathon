import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { degrees, PDFDocument } from "pdf-lib";
import type { Bir2307ZoneDefinition, Bir2307ZoneId } from "./zoneOcr";

const execFileAsync = promisify(execFile);

export interface PdfZoneRenderInput {
  content: Buffer;
  zone: Bir2307ZoneDefinition;
  sourceFileId: string;
  revision: string;
  pageNumber: number;
}

export interface PdfZoneRenderMetadata {
  zoneId: Bir2307ZoneId;
  renderDpi: number;
  renderMimeType: "image/png";
  renderElapsedMs: number;
  originalPdfBytes: number;
  renderedPdfBytes: number;
  renderedPngBytes: number;
  pageRotationDegrees: number;
  rotationNormalized: boolean;
  cropPixels: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pagePixels: {
    width: number;
    height: number;
  };
  renderer: "pdftoppm";
}

export interface PdfZoneRenderResult {
  content: Buffer;
  mimeType: "image/png";
  metadata: PdfZoneRenderMetadata;
}

export interface PdfZoneRenderer {
  render(input: PdfZoneRenderInput): Promise<PdfZoneRenderResult>;
}

export interface PdfZoneRendererConfig {
  dpi: number;
  timeoutMs: number;
}

export class PdfZoneRenderError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "PdfZoneRenderError";
    this.details = details;
  }
}

function toPositiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRotationDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

async function preparePdfForZoneRendering(content: Buffer, dpi: number) {
  const document = await PDFDocument.load(content);
  const [page] = document.getPages();
  if (!page) {
    throw new Error("PDF has no pages");
  }

  const { width, height } = page.getSize();
  const pageRotationDegrees = normalizeRotationDegrees(page.getRotation().angle);
  const rotationNormalized =
    pageRotationDegrees === 90 || pageRotationDegrees === 270;
  let renderContent = content;
  if (rotationNormalized) {
    page.setRotation(degrees(0));
    renderContent = Buffer.from(await document.save());
  }

  return {
    content: renderContent,
    pageRotationDegrees,
    rotationNormalized,
    pagePixels: {
      width: Math.round((width / 72) * dpi),
      height: Math.round((height / 72) * dpi),
    },
  };
}

export function createPdfZoneRenderer(
  config: PdfZoneRendererConfig,
): PdfZoneRenderer {
  const dpi = toPositiveInteger(config.dpi, 300);
  const timeoutMs = toPositiveInteger(config.timeoutMs, 60000);

  return {
    async render(input: PdfZoneRenderInput): Promise<PdfZoneRenderResult> {
      const started = Date.now();
      const dir = await mkdtemp(join(tmpdir(), "taxtrack-zone-render-"));
      const inputPath = join(dir, "page.pdf");
      const outputPrefix = join(dir, "zone");

      try {
        const prepared = await preparePdfForZoneRendering(input.content, dpi);
        const pagePixels = prepared.pagePixels;
        const x = clamp(
          Math.floor(input.zone.relativeRect.left * pagePixels.width),
          0,
          pagePixels.width - 1,
        );
        const y = clamp(
          Math.floor(input.zone.relativeRect.top * pagePixels.height),
          0,
          pagePixels.height - 1,
        );
        const width = clamp(
          Math.ceil(input.zone.relativeRect.width * pagePixels.width),
          1,
          pagePixels.width - x,
        );
        const height = clamp(
          Math.ceil(input.zone.relativeRect.height * pagePixels.height),
          1,
          pagePixels.height - y,
        );

        await writeFile(inputPath, prepared.content);
        await execFileAsync(
          "pdftoppm",
          [
            "-png",
            "-r",
            String(dpi),
            "-x",
            String(x),
            "-y",
            String(y),
            "-W",
            String(width),
            "-H",
            String(height),
            inputPath,
            outputPrefix,
          ],
          {
            maxBuffer: 100 * 1024 * 1024,
            timeout: timeoutMs,
          },
        );

        const files = await readdir(dir);
        const pngFile = files
          .filter((file) => file.toLowerCase().endsWith(".png"))
          .sort()[0];

        if (!pngFile) {
          throw new PdfZoneRenderError("PDF zone render did not produce a PNG", {
            sourceFileId: input.sourceFileId,
            revision: input.revision,
            pageNumber: input.pageNumber,
            zoneId: input.zone.id,
            dpi,
          });
        }

        const rendered = await readFile(join(dir, pngFile));
        return {
          content: rendered,
          mimeType: "image/png",
          metadata: {
            zoneId: input.zone.id,
            renderDpi: dpi,
            renderMimeType: "image/png",
            renderElapsedMs: Date.now() - started,
            originalPdfBytes: input.content.byteLength,
            renderedPdfBytes: prepared.content.byteLength,
            renderedPngBytes: rendered.byteLength,
            pageRotationDegrees: prepared.pageRotationDegrees,
            rotationNormalized: prepared.rotationNormalized,
            cropPixels: { x, y, width, height },
            pagePixels,
            renderer: "pdftoppm",
          },
        };
      } catch (error) {
        if (error instanceof PdfZoneRenderError) {
          throw error;
        }

        const stderr =
          typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : undefined;
        const message = error instanceof Error ? error.message : String(error);

        throw new PdfZoneRenderError(`PDF zone render failed: ${message}`, {
          sourceFileId: input.sourceFileId,
          revision: input.revision,
          pageNumber: input.pageNumber,
          zoneId: input.zone.id,
          dpi,
          stderr,
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
