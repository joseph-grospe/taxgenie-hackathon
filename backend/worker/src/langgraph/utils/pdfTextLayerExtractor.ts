import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PdfTextLayerExtractInput {
  content: Buffer;
  sourceFileId: string;
  revision: string;
  pageNumber: number;
}

export interface PdfTextLayerExtractMetadata {
  extractor: "pdftotext";
  layout: true;
  elapsedMs: number;
  originalPdfBytes: number;
  textLength: number;
}

export interface PdfTextLayerExtractResult {
  text: string;
  metadata: PdfTextLayerExtractMetadata;
}

export interface PdfTextLayerExtractor {
  extract(input: PdfTextLayerExtractInput): Promise<PdfTextLayerExtractResult>;
}

export interface PdfTextLayerExtractorConfig {
  timeoutMs: number;
}

export class PdfTextLayerExtractError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "PdfTextLayerExtractError";
    this.details = details;
  }
}

function toPositiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function createPdfTextLayerExtractor(
  config: PdfTextLayerExtractorConfig,
): PdfTextLayerExtractor {
  const timeoutMs = toPositiveInteger(config.timeoutMs, 60000);

  return {
    async extract(
      input: PdfTextLayerExtractInput,
    ): Promise<PdfTextLayerExtractResult> {
      const started = Date.now();
      const dir = await mkdtemp(join(tmpdir(), "taxtrack-pdf-text-"));
      const inputPath = join(dir, "page.pdf");

      try {
        await writeFile(inputPath, input.content);
        const result = await execFileAsync(
          "pdftotext",
          ["-layout", inputPath, "-"],
          {
            maxBuffer: 20 * 1024 * 1024,
            timeout: timeoutMs,
          },
        );
        const text = result.stdout.trim();

        return {
          text,
          metadata: {
            extractor: "pdftotext",
            layout: true,
            elapsedMs: Date.now() - started,
            originalPdfBytes: input.content.byteLength,
            textLength: text.length,
          },
        };
      } catch (error) {
        const stderr =
          typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : undefined;
        const message = error instanceof Error ? error.message : String(error);

        throw new PdfTextLayerExtractError(
          `PDF text-layer extraction failed: ${message}`,
          {
            sourceFileId: input.sourceFileId,
            revision: input.revision,
            pageNumber: input.pageNumber,
            elapsedMs: Date.now() - started,
            stderr,
          },
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
