import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";

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
  positioned: true;
  elapsedMs: number;
  originalPdfBytes: number;
  textLength: number;
}

export interface PdfTextLayerLine {
  text: string;
  bounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export interface PdfTextLayerExtractResult {
  text: string;
  page?: {
    width: number;
    height: number;
  };
  lines?: PdfTextLayerLine[];
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

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

function numberAttribute(attributes: string, name: string): number | undefined {
  const match = new RegExp(`${name}="([^"]+)"`, "u").exec(attributes);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

export function parsePositionedPdfText(xml: string): {
  page?: { width: number; height: number };
  lines: PdfTextLayerLine[];
  text: string;
} {
  const pageMatch = /<page\b([^>]*)>/u.exec(xml);
  const pageWidth = pageMatch
    ? numberAttribute(pageMatch[1] ?? "", "width")
    : undefined;
  const pageHeight = pageMatch
    ? numberAttribute(pageMatch[1] ?? "", "height")
    : undefined;
  const lines: PdfTextLayerLine[] = [];

  for (const match of xml.matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/gu)) {
    const attributes = match[1] ?? "";
    const left = numberAttribute(attributes, "xMin");
    const top = numberAttribute(attributes, "yMin");
    const right = numberAttribute(attributes, "xMax");
    const bottom = numberAttribute(attributes, "yMax");
    if (
      left === undefined ||
      top === undefined ||
      right === undefined ||
      bottom === undefined
    ) {
      continue;
    }

    const words = [...(match[2] ?? "").matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/gu)]
      .map((word) => decodeXmlText(word[1] ?? "").replace(/\s+/gu, " ").trim())
      .filter(Boolean);
    if (words.length === 0) {
      continue;
    }
    lines.push({
      text: words.join(" "),
      bounds: { left, top, right, bottom },
    });
  }

  return {
    page:
      pageWidth !== undefined && pageHeight !== undefined
        ? { width: pageWidth, height: pageHeight }
        : undefined,
    lines,
    text: lines.map((line) => line.text).join("\n"),
  };
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
      const dir = await mkdtemp(join(tmpdir(), "taxgenie-pdf-text-"));
      const inputPath = join(dir, "page.pdf");

      try {
        await writeFile(inputPath, input.content);
        const result = await execFileAsync(
          "pdftotext",
          ["-bbox-layout", inputPath, "-"],
          {
            encoding: "utf8",
            maxBuffer: 20 * 1024 * 1024,
            timeout: timeoutMs,
          },
        );
        const positioned = parsePositionedPdfText(result.stdout);
        const pdf = await PDFDocument.load(input.content);
        const firstPage = pdf.getPages()[0];
        const rotationDegrees =
          ((firstPage?.getRotation().angle ?? 0) % 360 + 360) % 360;
        const displayPage =
          positioned.page &&
          (rotationDegrees === 90 || rotationDegrees === 270)
            ? {
                width: positioned.page.height,
                height: positioned.page.width,
              }
            : positioned.page;
        const text = positioned.text.trim();

        return {
          text,
          page: displayPage,
          lines: positioned.lines,
          metadata: {
            extractor: "pdftotext",
            layout: true,
            positioned: true,
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
