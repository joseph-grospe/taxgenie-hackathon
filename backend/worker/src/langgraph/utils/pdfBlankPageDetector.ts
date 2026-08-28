import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_DPI = 72;
const DEFAULT_TIMEOUT_MS = 60_000;

interface PpmRasterAnalysis {
  width: number;
  height: number;
  nonWhitePixelCount: number;
}

export interface PdfBlankPageDetectionInput {
  content: Buffer;
  sourceFileId: string;
  revision: string;
  pageNumber: number;
}

export interface PdfBlankPageDetectionResult extends PpmRasterAnalysis {
  blank: boolean;
  dpi: number;
  elapsedMs: number;
}

export interface PdfBlankPageDetector {
  detect(
    input: PdfBlankPageDetectionInput,
  ): Promise<PdfBlankPageDetectionResult>;
}

export interface PdfBlankPageDetectorConfig {
  dpi?: number;
  timeoutMs?: number;
  command?: string;
}

type CommandRunner = (
  command: string,
  args: string[],
  options: {
    maxBuffer: number;
    timeout: number;
  },
) => Promise<void>;

interface PdfBlankPageDetectorDependencies {
  runCommand?: CommandRunner;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function isWhitespace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function readPpmToken(buffer: Buffer, offset: number) {
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    if (byte === 0x23) {
      while (cursor < buffer.length && buffer[cursor] !== 0x0a) {
        cursor += 1;
      }
      continue;
    }
    if (isWhitespace(byte)) {
      cursor += 1;
      continue;
    }
    break;
  }

  const start = cursor;
  while (
    cursor < buffer.length &&
    !isWhitespace(buffer[cursor]) &&
    buffer[cursor] !== 0x23
  ) {
    cursor += 1;
  }

  if (cursor === start) {
    throw new Error("PPM header is incomplete.");
  }

  return {
    token: buffer.toString("ascii", start, cursor),
    offset: cursor,
  };
}

export function analyzePpmBlankness(buffer: Buffer): PpmRasterAnalysis {
  const magic = readPpmToken(buffer, 0);
  if (magic.token !== "P6") {
    throw new Error("Unsupported PPM format.");
  }

  const widthToken = readPpmToken(buffer, magic.offset);
  const heightToken = readPpmToken(buffer, widthToken.offset);
  const maxToken = readPpmToken(buffer, heightToken.offset);
  const width = Number(widthToken.token);
  const height = Number(heightToken.token);
  const max = Number(maxToken.token);
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw new Error("Invalid PPM dimensions.");
  }
  if (max !== 255) {
    throw new Error("Unsupported PPM color depth.");
  }

  let dataOffset = maxToken.offset;
  if (buffer[dataOffset] === 0x0d && buffer[dataOffset + 1] === 0x0a) {
    dataOffset += 2;
  } else if (isWhitespace(buffer[dataOffset])) {
    dataOffset += 1;
  } else {
    throw new Error("PPM pixel delimiter is missing.");
  }

  const expectedLength = width * height * 3;
  const data = buffer.subarray(dataOffset, dataOffset + expectedLength);
  if (data.byteLength !== expectedLength) {
    throw new Error("PPM pixel data is incomplete.");
  }

  let nonWhitePixelCount = 0;
  for (let offset = 0; offset < data.length; offset += 3) {
    if (
      data[offset] !== 0xff ||
      data[offset + 1] !== 0xff ||
      data[offset + 2] !== 0xff
    ) {
      nonWhitePixelCount += 1;
    }
  }

  return { width, height, nonWhitePixelCount };
}

export function createPdfBlankPageDetector(
  config: PdfBlankPageDetectorConfig = {},
  dependencies: PdfBlankPageDetectorDependencies = {},
): PdfBlankPageDetector {
  const dpi = positiveInteger(config.dpi, DEFAULT_DPI);
  const timeoutMs = positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS);
  const command = config.command?.trim() || "pdftoppm";
  const runCommand: CommandRunner =
    dependencies.runCommand ??
    (async (file, args, options) => {
      await execFileAsync(file, args, options);
    });

  return {
    async detect(input): Promise<PdfBlankPageDetectionResult> {
      const started = Date.now();
      const directory = await mkdtemp(
        join(tmpdir(), "taxgenie-blank-page-render-"),
      );
      const inputPath = join(directory, "page.pdf");
      const outputPrefix = join(directory, "page");

      try {
        await writeFile(inputPath, input.content);
        await runCommand(
          command,
          [
            "-f",
            "1",
            "-l",
            "1",
            "-singlefile",
            "-r",
            String(dpi),
            inputPath,
            outputPrefix,
          ],
          {
            maxBuffer: 10 * 1024 * 1024,
            timeout: timeoutMs,
          },
        );
        const ppmFile = (await readdir(directory))
          .filter((file) => file.toLowerCase().endsWith(".ppm"))
          .sort()[0];
        if (!ppmFile) {
          throw new Error("Blank-page render did not produce a PPM.");
        }

        const analysis = analyzePpmBlankness(
          await readFile(join(directory, ppmFile)),
        );
        return {
          ...analysis,
          blank: analysis.nonWhitePixelCount === 0,
          dpi,
          elapsedMs: Date.now() - started,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Blank-page detection failed for ${input.sourceFileId} page ${input.pageNumber}: ${message}`,
          { cause: error },
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
