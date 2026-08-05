import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PdfRegionRenderInput {
  content: Buffer;
  sourceFileId: string;
  revision: string;
  pageNumber: number;
  dpi: number;
  pagePixels: {
    width: number;
    height: number;
  };
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PdfRegionRenderResult {
  content: Buffer;
  mimeType: "image/png";
  metadata: {
    renderer: "pdftoppm";
    dpi: number;
    elapsedMs: number;
    renderedBytes: number;
    bounds: PdfRegionRenderInput["bounds"];
  };
}

export interface PdfRegionRenderer {
  render(input: PdfRegionRenderInput): Promise<PdfRegionRenderResult>;
}

export interface PdfRegionRendererConfig {
  timeoutMs: number;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createPdfRegionRenderer(
  config: PdfRegionRendererConfig,
): PdfRegionRenderer {
  const timeoutMs = positiveInteger(config.timeoutMs, 60_000);

  return {
    async render(input): Promise<PdfRegionRenderResult> {
      const started = Date.now();
      const directory = await mkdtemp(
        join(tmpdir(), "taxtrack-payor-signer-region-"),
      );
      const inputPath = join(directory, "page.pdf");
      const outputPrefix = join(directory, "payor-signer");
      const dpi = positiveInteger(input.dpi, 300);
      const x = clamp(
        Math.floor(input.bounds.x),
        0,
        Math.max(0, input.pagePixels.width - 1),
      );
      const y = clamp(
        Math.floor(input.bounds.y),
        0,
        Math.max(0, input.pagePixels.height - 1),
      );
      const width = clamp(
        Math.ceil(input.bounds.width),
        1,
        Math.max(1, input.pagePixels.width - x),
      );
      const height = clamp(
        Math.ceil(input.bounds.height),
        1,
        Math.max(1, input.pagePixels.height - y),
      );
      const bounds = { x, y, width, height };

      try {
        await writeFile(inputPath, input.content);
        await execFileAsync(
          "pdftoppm",
          [
            "-f",
            "1",
            "-singlefile",
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
        const pngFile = (await readdir(directory))
          .filter((file) => file.toLowerCase().endsWith(".png"))
          .sort()[0];
        if (!pngFile) {
          throw new Error("Payor signer region render did not produce a PNG.");
        }
        const content = await readFile(join(directory, pngFile));
        return {
          content,
          mimeType: "image/png",
          metadata: {
            renderer: "pdftoppm",
            dpi,
            elapsedMs: Date.now() - started,
            renderedBytes: content.byteLength,
            bounds,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Payor signer region rendering failed for ${input.sourceFileId} page ${input.pageNumber}: ${message}`,
          { cause: error },
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
