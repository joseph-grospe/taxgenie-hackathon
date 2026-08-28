import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PAYOR_SIGNATURE_REGION = {
  left: 0.04,
  top: 0.66,
  width: 0.92,
  height: 0.31,
} as const;

const FALLBACK_ANALYSIS_BANDS = [
  {
    id: "upper_payor_line",
    top: 0.32,
    bottom: 0.49,
  },
  {
    id: "payor_block_body",
    top: 0.49,
    bottom: 0.68,
  },
] as const;

const RULE_LUMINANCE_THRESHOLD = 180;
const LONG_HORIZONTAL_RULE_DARK_RATIO = 0.42;
const VERTICAL_RULE_DARK_RATIO = 0.55;
const MIN_GRID_TOP_RATIO = 0.3;
const MIN_GRID_VERTICAL_RULE_GROUPS = 6;
const STRUCTURE_UPWARD_MARGIN_RATIO = 0.14;
const STRUCTURE_IDENTITY_UPWARD_MARGIN_RATIO = 0.28;
const STRUCTURE_MIN_UPWARD_MARGIN_PIXELS = 32;

interface RasterImage {
  width: number;
  height: number;
  data: Buffer;
}

type RasterRotation = "none" | "clockwise_90" | "counterclockwise_90";

export interface SignatureVisualDetectorInput {
  content: Buffer;
  sourceFileId: string;
  revision: string;
  pageNumber: number;
}

export interface SignatureVisualDetectionResult {
  status: "detected" | "not_detected";
  signaturePresent: boolean;
  confidence: number;
  signerRecoveryEligible?: boolean;
  signerRecoveryReason?:
    | "visual_signature_detected"
    | "payor_signer_band_visible";
  structure?: {
    payorSignerBandVisible: boolean;
    structuredWindowCount: number;
    analysisWindowCount: number;
    payorSignerWindow?: {
      normalized: {
        left: number;
        top: number;
        width: number;
        height: number;
      };
      pixels: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };
  };
  metrics: {
    darkPixelCount: number;
    candidateCount: number;
    largestCandidateArea: number;
    largestCandidateWidth: number;
    largestCandidateHeight: number;
    analysisWidth: number;
    analysisHeight: number;
  };
  render: {
    dpi: number;
    elapsedMs: number;
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
    originalPagePixels?: {
      width: number;
      height: number;
    };
    rotationApplied?: RasterRotation;
  };
}

export interface SignatureVisualDetector {
  detect(
    input: SignatureVisualDetectorInput,
  ): Promise<SignatureVisualDetectionResult>;
}

export interface SignatureVisualDetectorConfig {
  dpi: number;
  timeoutMs: number;
}

interface Component {
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnalysisMask {
  mask: Uint8Array;
  darkPixelCount: number;
}

interface RuleGroup {
  start: number;
  end: number;
  center: number;
}

interface AnalysisWindow {
  top: number;
  height: number;
}

interface StructuredAnalysisWindow extends AnalysisWindow {
  gridTopRatio: number;
  gridTopY: number;
}

function toPositiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readPpmToken(buffer: Buffer, offset: number) {
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    if (byte === 0x23) {
      while (cursor < buffer.length && buffer[cursor] !== 0x0a) {
        cursor += 1;
      }
    } else if (
      byte === 0x20 ||
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d
    ) {
      cursor += 1;
    } else {
      break;
    }
  }

  const start = cursor;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      break;
    }
    cursor += 1;
  }

  return {
    token: buffer.toString("ascii", start, cursor),
    offset: cursor,
  };
}

export function parsePpm(buffer: Buffer): RasterImage {
  const magic = readPpmToken(buffer, 0);
  if (magic.token !== "P6") {
    throw new Error("Unsupported PPM format");
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
    throw new Error("Invalid PPM dimensions");
  }
  if (max !== 255) {
    throw new Error("Unsupported PPM color depth");
  }

  let dataOffset = maxToken.offset;
  if (
    dataOffset < buffer.length &&
    [0x20, 0x09, 0x0a, 0x0d].includes(buffer[dataOffset])
  ) {
    dataOffset += 1;
  }

  const expectedLength = width * height * 3;
  const data = buffer.subarray(dataOffset, dataOffset + expectedLength);
  if (data.byteLength !== expectedLength) {
    throw new Error("PPM pixel data is incomplete");
  }

  return { width, height, data };
}

function luminance(data: Buffer, pixelIndex: number): number {
  const offset = pixelIndex * 3;
  return (
    0.2126 * data[offset] +
    0.7152 * data[offset + 1] +
    0.0722 * data[offset + 2]
  );
}

function findContentBounds(raster: RasterImage): PixelRect {
  let minX = raster.width;
  let minY = raster.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (luminance(raster.data, y * raster.width + x) < 240) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: raster.width, height: raster.height };
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const padX = Math.max(4, Math.round(width * 0.01));
  const padY = Math.max(4, Math.round(height * 0.01));
  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  const right = Math.min(raster.width, maxX + 1 + padX);
  const bottom = Math.min(raster.height, maxY + 1 + padY);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function getPayorSignatureCropBounds(raster: RasterImage): PixelRect {
  const content = findContentBounds(raster);
  const x = Math.floor(content.x + PAYOR_SIGNATURE_REGION.left * content.width);
  const y = Math.floor(content.y + PAYOR_SIGNATURE_REGION.top * content.height);
  const width = Math.ceil(PAYOR_SIGNATURE_REGION.width * content.width);
  const height = Math.ceil(PAYOR_SIGNATURE_REGION.height * content.height);
  const clippedX = Math.max(0, Math.min(x, raster.width - 1));
  const clippedY = Math.max(0, Math.min(y, raster.height - 1));

  return {
    x: clippedX,
    y: clippedY,
    width: Math.max(1, Math.min(width, raster.width - clippedX)),
    height: Math.max(1, Math.min(height, raster.height - clippedY)),
  };
}

function cropRaster(raster: RasterImage, crop: PixelRect): RasterImage {
  const data = Buffer.alloc(crop.width * crop.height * 3);

  for (let y = 0; y < crop.height; y += 1) {
    const sourceStart = ((crop.y + y) * raster.width + crop.x) * 3;
    const targetStart = y * crop.width * 3;
    raster.data.copy(
      data,
      targetStart,
      sourceStart,
      sourceStart + crop.width * 3,
    );
  }

  return {
    width: crop.width,
    height: crop.height,
    data,
  };
}

function rotateRasterClockwise(raster: RasterImage): RasterImage {
  const width = raster.height;
  const height = raster.width;
  const data = Buffer.alloc(width * height * 3);

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const targetX = raster.height - 1 - y;
      const targetY = x;
      const sourceStart = (y * raster.width + x) * 3;
      const targetStart = (targetY * width + targetX) * 3;
      raster.data.copy(data, targetStart, sourceStart, sourceStart + 3);
    }
  }

  return { width, height, data };
}

function rotateRasterCounterclockwise(raster: RasterImage): RasterImage {
  const width = raster.height;
  const height = raster.width;
  const data = Buffer.alloc(width * height * 3);

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const targetX = y;
      const targetY = raster.width - 1 - x;
      const sourceStart = (y * raster.width + x) * 3;
      const targetStart = (targetY * width + targetX) * 3;
      raster.data.copy(data, targetStart, sourceStart, sourceStart + 3);
    }
  }

  return { width, height, data };
}

function getSignaturePageOrientations(raster: RasterImage): Array<{
  raster: RasterImage;
  rotationApplied: RasterRotation;
}> {
  if (raster.width <= raster.height) {
    return [{ raster, rotationApplied: "none" }];
  }

  return [
    {
      raster: rotateRasterClockwise(raster),
      rotationApplied: "clockwise_90",
    },
    {
      raster: rotateRasterCounterclockwise(raster),
      rotationApplied: "counterclockwise_90",
    },
  ];
}

function mapNormalizedRectToOriginal(
  rect: PixelRect,
  original: RasterImage,
  rotationApplied: RasterRotation,
): PixelRect {
  if (rotationApplied === "none") {
    return rect;
  }
  if (rotationApplied === "counterclockwise_90") {
    return {
      x: Math.max(0, original.width - rect.y - rect.height),
      y: rect.x,
      width: rect.height,
      height: rect.width,
    };
  }

  return {
    x: rect.y,
    y: Math.max(0, original.height - rect.x - rect.width),
    width: rect.height,
    height: rect.width,
  };
}

function normalizePixelRect(
  rect: PixelRect,
  page: { width: number; height: number },
) {
  return {
    left: rect.x / page.width,
    top: rect.y / page.height,
    width: rect.width / page.width,
    height: rect.height / page.height,
  };
}

function markLineNeighborhood(target: Set<number>, index: number, max: number) {
  for (let delta = -2; delta <= 2; delta += 1) {
    const next = index + delta;
    if (next >= 0 && next < max) {
      target.add(next);
    }
  }
}

function getComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): Component[] {
  const visited = new Uint8Array(mask.length);
  const components: Component[] = [];
  const queue: number[] = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0 || visited[index] === 1) {
      continue;
    }

    visited[index] = 1;
    queue.length = 0;
    queue.push(index);
    let head = 0;
    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      area += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
            continue;
          }
          const nextIndex = nextY * width + nextX;
          if (mask[nextIndex] === 1 && visited[nextIndex] === 0) {
            visited[nextIndex] = 1;
            queue.push(nextIndex);
          }
        }
      }
    }

    components.push({ area, minX, maxX, minY, maxY });
  }

  return components;
}

function isSignatureCandidate(component: Component): boolean {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const density = component.area / (width * height);

  return (
    component.area >= 80 &&
    width >= 70 &&
    height >= 16 &&
    density <= 0.42 &&
    height / width <= 0.85
  );
}

function isTallSignatureCandidate(
  component: Component,
  analysisHeight: number,
): boolean {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const density = component.area / (width * height);
  const beginsInUpperBand = component.minY < analysisHeight * 0.55;
  const spansSignerLine = component.maxY > analysisHeight * 0.25;

  return (
    component.area >= 300 &&
    width >= 20 &&
    width <= 120 &&
    height >= 45 &&
    density <= 0.4 &&
    height / width > 0.85 &&
    beginsInUpperBand &&
    spansSignerLine
  );
}

function isFaintSignatureCandidate(
  component: Component,
  analysisHeight: number,
): boolean {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const density = component.area / (width * height);
  const beginsInUpperBand = component.minY < analysisHeight * 0.55;
  const staysAboveLabelBand = component.maxY < analysisHeight * 0.75;

  return (
    component.area >= 180 &&
    width >= 55 &&
    height >= 22 &&
    density <= 0.3 &&
    height / width <= 0.85 &&
    beginsInUpperBand &&
    staysAboveLabelBand
  );
}

function getComponentWidth(component: Component): number {
  return component.maxX - component.minX + 1;
}

function getComponentHeight(component: Component): number {
  return component.maxY - component.minY + 1;
}

function mergeLooseSignatureFragments(
  components: Component[],
  analysisWidth: number,
  analysisHeight: number,
): Component[] {
  const fragments = components
    .filter((component) => {
      const width = getComponentWidth(component);
      const height = getComponentHeight(component);
      const density = component.area / (width * height);

      return (
        component.area >= 8 &&
        width >= 2 &&
        height >= 2 &&
        width <= analysisWidth * 0.34 &&
        height <= analysisHeight * 0.72 &&
        density <= 0.78 &&
        component.minY < analysisHeight * 0.72 &&
        component.maxY < analysisHeight * 0.9
      );
    })
    .sort((left, right) => left.minX - right.minX);

  const clusters: Component[] = [];
  for (const fragment of fragments) {
    const nearbyCluster = clusters.find((cluster) => {
      const horizontalGap =
        fragment.minX > cluster.maxX
          ? fragment.minX - cluster.maxX
          : cluster.minX - fragment.maxX;
      const verticalGap =
        fragment.minY > cluster.maxY
          ? fragment.minY - cluster.maxY
          : cluster.minY - fragment.maxY;

      return horizontalGap <= 42 && verticalGap <= 34;
    });

    if (!nearbyCluster) {
      clusters.push({ ...fragment });
      continue;
    }

    nearbyCluster.area += fragment.area;
    nearbyCluster.minX = Math.min(nearbyCluster.minX, fragment.minX);
    nearbyCluster.maxX = Math.max(nearbyCluster.maxX, fragment.maxX);
    nearbyCluster.minY = Math.min(nearbyCluster.minY, fragment.minY);
    nearbyCluster.maxY = Math.max(nearbyCluster.maxY, fragment.maxY);
  }

  return clusters.filter((cluster) => {
    const width = getComponentWidth(cluster);
    const height = getComponentHeight(cluster);
    const density = cluster.area / (width * height);
    const startsAboveSignerText = cluster.minY < analysisHeight * 0.62;
    const hasVerticalMovement =
      height >= Math.max(28, Math.round(analysisHeight * 0.16));
    const notPrintedTextLine = !(
      width > analysisWidth * 0.42 && height < analysisHeight * 0.22
    );

    return (
      cluster.area >= 120 &&
      width >= 28 &&
      height >= 18 &&
      width <= analysisWidth * 0.42 &&
      density <= 0.34 &&
      startsAboveSignerText &&
      hasVerticalMovement &&
      notPrintedTextLine
    );
  });
}

function getComponentDensity(component: Component): number {
  return (
    component.area /
    (getComponentWidth(component) * getComponentHeight(component))
  );
}

function mergeNearbyFragments(
  components: Component[],
  horizontalGapLimit: number,
  verticalGapLimit: number,
): Component[] {
  const clusters: Component[] = [];
  for (const fragment of components) {
    const nearbyCluster = clusters.find((cluster) => {
      const horizontalGap =
        fragment.minX > cluster.maxX
          ? fragment.minX - cluster.maxX
          : cluster.minX - fragment.maxX;
      const verticalGap =
        fragment.minY > cluster.maxY
          ? fragment.minY - cluster.maxY
          : cluster.minY - fragment.maxY;

      return (
        horizontalGap <= horizontalGapLimit && verticalGap <= verticalGapLimit
      );
    });

    if (!nearbyCluster) {
      clusters.push({ ...fragment });
      continue;
    }

    nearbyCluster.area += fragment.area;
    nearbyCluster.minX = Math.min(nearbyCluster.minX, fragment.minX);
    nearbyCluster.maxX = Math.max(nearbyCluster.maxX, fragment.maxX);
    nearbyCluster.minY = Math.min(nearbyCluster.minY, fragment.minY);
    nearbyCluster.maxY = Math.max(nearbyCluster.maxY, fragment.maxY);
  }

  return clusters;
}

function isSparseLowerHandwritingCluster(
  cluster: Component,
  analysisWidth: number,
  analysisHeight: number,
): boolean {
  const width = getComponentWidth(cluster);
  const height = getComponentHeight(cluster);
  const density = getComponentDensity(cluster);

  return (
    cluster.area >= 160 &&
    width >= analysisWidth * 0.25 &&
    width <= analysisWidth * 0.56 &&
    height >= Math.max(28, Math.round(analysisHeight * 0.18)) &&
    density <= 0.08 &&
    cluster.minY > analysisHeight * 0.58 &&
    cluster.minY < analysisHeight * 0.75 &&
    cluster.maxY > analysisHeight * 0.79
  );
}

function isLowerOverprintSignatureCluster(
  cluster: Component,
  analysisWidth: number,
  analysisHeight: number,
): boolean {
  const width = getComponentWidth(cluster);
  const height = getComponentHeight(cluster);
  const density = getComponentDensity(cluster);

  return (
    cluster.area >= 320 &&
    width >= analysisWidth * 0.16 &&
    width <= analysisWidth * 0.34 &&
    height >= Math.max(42, Math.round(analysisHeight * 0.14)) &&
    height <= analysisHeight * 0.42 &&
    density <= 0.32 &&
    cluster.minY > analysisHeight * 0.55 &&
    cluster.minY < analysisHeight * 0.82 &&
    cluster.maxY > analysisHeight * 0.72
  );
}

function mergeOverprintedSignerInkFragments(
  components: Component[],
  analysisWidth: number,
  analysisHeight: number,
): Component[] {
  const fragments = components
    .filter((component) => {
      const width = getComponentWidth(component);
      const height = getComponentHeight(component);
      const density = component.area / (width * height);
      const fullWidthRule = width > analysisWidth * 0.58 && height <= 6;

      return (
        component.area >= 10 &&
        width >= 2 &&
        height >= 2 &&
        density <= 0.9 &&
        !fullWidthRule &&
        component.minY < analysisHeight * 0.84 &&
        component.maxY > analysisHeight * 0.12
      );
    })
    .sort((left, right) => left.minX - right.minX);

  const clusters = mergeNearbyFragments(
    fragments,
    Math.max(34, Math.round(analysisWidth * 0.08)),
    Math.max(28, Math.round(analysisHeight * 0.2)),
  );

  return clusters.filter((cluster) => {
    const width = getComponentWidth(cluster);
    const height = getComponentHeight(cluster);
    const density = getComponentDensity(cluster);
    const startsBeforeLabelBand = cluster.minY < analysisHeight * 0.68;
    const reachesSignerBand = cluster.maxY > analysisHeight * 0.24;
    const broadHandwriting =
      width >= Math.max(62, Math.round(analysisWidth * 0.14)) &&
      height >= Math.max(24, Math.round(analysisHeight * 0.18)) &&
      height / width <= 0.85;
    const tallOverprint =
      height >= Math.max(44, Math.round(analysisHeight * 0.28)) &&
      width >= 12 &&
      width <= analysisWidth * 0.32;
    const loopOrStamp =
      width >= Math.max(48, Math.round(analysisWidth * 0.1)) &&
      height >= Math.max(38, Math.round(analysisHeight * 0.26)) &&
      density <= 0.62;
    const printedNameLine =
      width > analysisWidth * 0.48 &&
      height < Math.max(24, Math.round(analysisHeight * 0.2));
    const lowerTextOnly =
      cluster.minY > analysisHeight * 0.62 &&
      height < Math.max(34, Math.round(analysisHeight * 0.26));
    const sparseLowerHandwriting = isSparseLowerHandwritingCluster(
      cluster,
      analysisWidth,
      analysisHeight,
    );
    const lowerOverprintSignature = isLowerOverprintSignatureCluster(
      cluster,
      analysisWidth,
      analysisHeight,
    );

    return (
      cluster.area >= 180 &&
      reachesSignerBand &&
      density <= 0.68 &&
      !printedNameLine &&
      ((startsBeforeLabelBand &&
        !lowerTextOnly &&
        (broadHandwriting || tallOverprint || loopOrStamp)) ||
        sparseLowerHandwriting ||
        lowerOverprintSignature)
    );
  });
}

function mergeLowerCompactMarkFragments(
  components: Component[],
  analysisWidth: number,
  analysisHeight: number,
): Component[] {
  const fragments = components
    .filter((component) => {
      const width = getComponentWidth(component);
      const height = getComponentHeight(component);
      const density = getComponentDensity(component);
      const centerX = (component.minX + component.maxX) / 2 / analysisWidth;
      const centerY = (component.minY + component.maxY) / 2 / analysisHeight;

      return (
        component.area >= 70 &&
        width >= 4 &&
        width <= Math.max(42, Math.round(analysisWidth * 0.04)) &&
        height >= 6 &&
        height <= Math.max(36, Math.round(analysisHeight * 0.18)) &&
        density >= 0.16 &&
        density <= 0.92 &&
        centerX >= 0.43 &&
        centerX <= 0.62 &&
        centerY >= 0.5 &&
        centerY <= 0.98
      );
    })
    .sort((left, right) => left.minX - right.minX);

  const clusters = mergeNearbyFragments(
    fragments,
    Math.max(52, Math.round(analysisWidth * 0.03)),
    Math.max(34, Math.round(analysisHeight * 0.16)),
  );

  return clusters.filter((cluster) => {
    const width = getComponentWidth(cluster);
    const height = getComponentHeight(cluster);
    const density = getComponentDensity(cluster);
    const centerX = (cluster.minX + cluster.maxX) / 2 / analysisWidth;

    return (
      cluster.area >= 340 &&
      width >= 28 &&
      width <= Math.max(130, Math.round(analysisWidth * 0.1)) &&
      height >= 18 &&
      height <= Math.max(82, Math.round(analysisHeight * 0.48)) &&
      density <= 0.75 &&
      centerX >= 0.45 &&
      centerX <= 0.6 &&
      cluster.minY > analysisHeight * 0.45 &&
      cluster.maxY > analysisHeight * 0.55
    );
  });
}

function mergeColoredSignerInkFragments(
  components: Component[],
  analysisWidth: number,
  analysisHeight: number,
): Component[] {
  const fragments = components
    .filter((component) => {
      const width = getComponentWidth(component);
      const height = getComponentHeight(component);
      const density = getComponentDensity(component);
      const centerX = (component.minX + component.maxX) / 2 / analysisWidth;

      return (
        component.area >= 8 &&
        width >= 2 &&
        height >= 2 &&
        density <= 0.95 &&
        centerX >= 0.3 &&
        centerX <= 0.7
      );
    })
    .sort((left, right) => left.minX - right.minX);

  const clusters = mergeNearbyFragments(
    fragments,
    Math.max(42, Math.round(analysisWidth * 0.05)),
    Math.max(30, Math.round(analysisHeight * 0.18)),
  );

  return clusters.filter((cluster) => {
    const width = getComponentWidth(cluster);
    const height = getComponentHeight(cluster);
    const density = getComponentDensity(cluster);
    const centerX = (cluster.minX + cluster.maxX) / 2 / analysisWidth;

    return (
      cluster.area >= 90 &&
      width >= 30 &&
      width <= analysisWidth * 0.36 &&
      height >= 22 &&
      height <= analysisHeight * 0.82 &&
      density <= 0.68 &&
      centerX >= 0.34 &&
      centerX <= 0.66
    );
  });
}

function findFaintLowerSignerInkComponents(
  components: Component[],
  analysisWidth: number,
  analysisHeight: number,
): Component[] {
  return components.filter((component) => {
    const width = getComponentWidth(component);
    const height = getComponentHeight(component);
    const density = getComponentDensity(component);
    const centerX = (component.minX + component.maxX) / 2 / analysisWidth;

    return (
      component.area >= 260 &&
      width >= 52 &&
      width <= 180 &&
      height >= 30 &&
      height <= Math.max(70, Math.round(analysisHeight * 0.3)) &&
      density >= 0.18 &&
      density <= 0.62 &&
      centerX >= 0.38 &&
      centerX <= 0.58 &&
      component.minY > analysisHeight * 0.42 &&
      component.maxY > analysisHeight * 0.55 &&
      component.maxY < analysisHeight * 0.82
    );
  });
}

function buildAnalysisMask(
  raster: RasterImage,
  threshold: number,
  analysisTop: number,
  analysisHeight: number,
  options: { localContrast?: number } = {},
): AnalysisMask {
  const mask = new Uint8Array(raster.width * analysisHeight);
  const rowDarkCounts = new Uint32Array(analysisHeight);
  const colDarkCounts = new Uint32Array(raster.width);
  const rowReferenceLuminance = options.localContrast
    ? new Float32Array(analysisHeight)
    : undefined;
  let darkPixelCount = 0;

  if (rowReferenceLuminance) {
    for (let y = 0; y < analysisHeight; y += 1) {
      let rowMax = 0;
      for (let x = 0; x < raster.width; x += 1) {
        rowMax = Math.max(
          rowMax,
          luminance(raster.data, (analysisTop + y) * raster.width + x),
        );
      }
      rowReferenceLuminance[y] = rowMax;
    }
  }

  for (let y = 0; y < analysisHeight; y += 1) {
    const rowThreshold =
      rowReferenceLuminance && options.localContrast
        ? Math.min(threshold, rowReferenceLuminance[y] - options.localContrast)
        : threshold;
    for (let x = 0; x < raster.width; x += 1) {
      const sourceIndex = (analysisTop + y) * raster.width + x;
      if (luminance(raster.data, sourceIndex) < rowThreshold) {
        const maskIndex = y * raster.width + x;
        mask[maskIndex] = 1;
        rowDarkCounts[y] += 1;
        colDarkCounts[x] += 1;
        darkPixelCount += 1;
      }
    }
  }

  const lineRows = new Set<number>();
  const lineCols = new Set<number>();
  for (let y = 0; y < analysisHeight; y += 1) {
    if (rowDarkCounts[y] > raster.width * 0.42) {
      markLineNeighborhood(lineRows, y, analysisHeight);
    }
  }
  for (let x = 0; x < raster.width; x += 1) {
    if (colDarkCounts[x] > analysisHeight * 0.55) {
      markLineNeighborhood(lineCols, x, raster.width);
    }
  }

  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (lineRows.has(y) || lineCols.has(x)) {
        mask[y * raster.width + x] = 0;
      }
    }
  }

  return {
    mask,
    darkPixelCount,
  };
}

function getHistogramPercentile(
  histogram: Uint32Array,
  total: number,
  percentile: number,
): number {
  const target = Math.max(0, Math.floor(total * percentile));
  let accumulated = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    accumulated += histogram[value];
    if (accumulated >= target) {
      return value;
    }
  }

  return histogram.length - 1;
}

function buildRowContrastMask(
  raster: RasterImage,
  analysisTop: number,
  analysisHeight: number,
  options: { delta: number; percentile: number },
): AnalysisMask {
  const mask = new Uint8Array(raster.width * analysisHeight);
  const rowDarkCounts = new Uint32Array(analysisHeight);
  const colDarkCounts = new Uint32Array(raster.width);
  let darkPixelCount = 0;

  for (let y = 0; y < analysisHeight; y += 1) {
    const histogram = new Uint32Array(256);
    for (let x = 0; x < raster.width; x += 1) {
      const value = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            luminance(raster.data, (analysisTop + y) * raster.width + x),
          ),
        ),
      );
      histogram[value] += 1;
    }

    const baseline = getHistogramPercentile(
      histogram,
      raster.width,
      options.percentile,
    );
    const rowThreshold = Math.min(235, baseline - options.delta);
    for (let x = 0; x < raster.width; x += 1) {
      const sourceIndex = (analysisTop + y) * raster.width + x;
      if (luminance(raster.data, sourceIndex) < rowThreshold) {
        const maskIndex = y * raster.width + x;
        mask[maskIndex] = 1;
        rowDarkCounts[y] += 1;
        colDarkCounts[x] += 1;
        darkPixelCount += 1;
      }
    }
  }

  const lineRows = new Set<number>();
  const lineCols = new Set<number>();
  for (let y = 0; y < analysisHeight; y += 1) {
    if (rowDarkCounts[y] > raster.width * 0.42) {
      markLineNeighborhood(lineRows, y, analysisHeight);
    }
  }
  for (let x = 0; x < raster.width; x += 1) {
    if (colDarkCounts[x] > analysisHeight * 0.55) {
      markLineNeighborhood(lineCols, x, raster.width);
    }
  }

  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (lineRows.has(y) || lineCols.has(x)) {
        mask[y * raster.width + x] = 0;
      }
    }
  }

  return {
    mask,
    darkPixelCount,
  };
}

function isBlueInkPixel(data: Buffer, pixelIndex: number): boolean {
  const offset = pixelIndex * 3;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);

  return (
    max < 245 &&
    min < 230 &&
    max - min >= 28 &&
    blue > red + 20 &&
    blue > green + 8
  );
}

function buildBlueInkMask(
  raster: RasterImage,
  analysisTop: number,
  analysisHeight: number,
): AnalysisMask {
  const mask = new Uint8Array(raster.width * analysisHeight);
  const rowDarkCounts = new Uint32Array(analysisHeight);
  const colDarkCounts = new Uint32Array(raster.width);
  let darkPixelCount = 0;

  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const sourceIndex = (analysisTop + y) * raster.width + x;
      if (isBlueInkPixel(raster.data, sourceIndex)) {
        const maskIndex = y * raster.width + x;
        mask[maskIndex] = 1;
        rowDarkCounts[y] += 1;
        colDarkCounts[x] += 1;
        darkPixelCount += 1;
      }
    }
  }

  const lineRows = new Set<number>();
  const lineCols = new Set<number>();
  for (let y = 0; y < analysisHeight; y += 1) {
    if (rowDarkCounts[y] > raster.width * 0.42) {
      markLineNeighborhood(lineRows, y, analysisHeight);
    }
  }
  for (let x = 0; x < raster.width; x += 1) {
    if (colDarkCounts[x] > analysisHeight * 0.55) {
      markLineNeighborhood(lineCols, x, raster.width);
    }
  }

  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (lineRows.has(y) || lineCols.has(x)) {
        mask[y * raster.width + x] = 0;
      }
    }
  }

  return {
    mask,
    darkPixelCount,
  };
}

function getRowDarkCounts(raster: RasterImage, threshold: number): Uint32Array {
  const rowDarkCounts = new Uint32Array(raster.height);

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if (luminance(raster.data, y * raster.width + x) < threshold) {
        rowDarkCounts[y] += 1;
      }
    }
  }

  return rowDarkCounts;
}

function getHorizontalRuleGroups(raster: RasterImage): RuleGroup[] {
  const rowDarkCounts = getRowDarkCounts(raster, RULE_LUMINANCE_THRESHOLD);
  const minDarkPixels = raster.width * LONG_HORIZONTAL_RULE_DARK_RATIO;
  const groups: RuleGroup[] = [];
  let start: number | undefined;

  for (let y = 0; y < raster.height; y += 1) {
    if (rowDarkCounts[y] >= minDarkPixels) {
      start ??= y;
      continue;
    }

    if (start !== undefined) {
      const end = y - 1;
      groups.push({
        start,
        end,
        center: Math.round((start + end) / 2),
      });
      start = undefined;
    }
  }

  if (start !== undefined) {
    const end = raster.height - 1;
    groups.push({
      start,
      end,
      center: Math.round((start + end) / 2),
    });
  }

  return groups;
}

function getVerticalRuleGroupCount(
  raster: RasterImage,
  top: number,
  bottom: number,
): number {
  const clippedTop = Math.max(0, Math.min(top + 2, raster.height - 1));
  const clippedBottom = Math.max(
    clippedTop,
    Math.min(bottom - 2, raster.height - 1),
  );
  const intervalHeight = clippedBottom - clippedTop + 1;
  const minDarkPixels = intervalHeight * VERTICAL_RULE_DARK_RATIO;
  let groupCount = 0;
  let insideGroup = false;

  for (let x = 0; x < raster.width; x += 1) {
    let darkPixels = 0;
    for (let y = clippedTop; y <= clippedBottom; y += 1) {
      if (
        luminance(raster.data, y * raster.width + x) < RULE_LUMINANCE_THRESHOLD
      ) {
        darkPixels += 1;
      }
    }

    if (darkPixels >= minDarkPixels) {
      if (!insideGroup) {
        groupCount += 1;
        insideGroup = true;
      }
      continue;
    }

    insideGroup = false;
  }

  return groupCount;
}

function getFallbackAnalysisWindows(raster: RasterImage): AnalysisWindow[] {
  return FALLBACK_ANALYSIS_BANDS.map((band) => {
    const top = Math.floor(raster.height * band.top);
    const bottom = Math.ceil(raster.height * band.bottom);

    return {
      top,
      height: Math.max(1, bottom - top),
    };
  });
}

function getStructuredAnalysisWindowCandidates(
  raster: RasterImage,
): StructuredAnalysisWindow[] {
  const rules = getHorizontalRuleGroups(raster);
  const minGridTop = raster.height * MIN_GRID_TOP_RATIO;
  const minGridHeight = Math.max(18, Math.round(raster.height * 0.05));
  const eligibleWindows: StructuredAnalysisWindow[] = [];

  for (let index = 1; index < rules.length - 1; index += 1) {
    const gridTopRule = rules[index];
    const gridBottomRule = rules[index + 1];
    const gridHeight = gridBottomRule.center - gridTopRule.center + 1;
    if (gridTopRule.center < minGridTop || gridHeight < minGridHeight) {
      continue;
    }

    const verticalRuleCount = getVerticalRuleGroupCount(
      raster,
      gridTopRule.center,
      gridBottomRule.center,
    );
    if (verticalRuleCount < MIN_GRID_VERTICAL_RULE_GROUPS) {
      continue;
    }

    const signerLineRule = rules[index - 1];
    const upwardMargin = Math.max(
      STRUCTURE_MIN_UPWARD_MARGIN_PIXELS,
      Math.round(raster.height * STRUCTURE_UPWARD_MARGIN_RATIO),
    );
    const top = Math.max(0, signerLineRule.center - upwardMargin);
    const bottom = Math.max(top + 1, gridTopRule.center);

    eligibleWindows.push({
      top,
      height: bottom - top,
      gridTopRatio: gridTopRule.center / raster.height,
      gridTopY: gridTopRule.center,
    });
  }

  return eligibleWindows;
}

function selectPreferredStructuredWindow(
  eligibleWindows: StructuredAnalysisWindow[],
): StructuredAnalysisWindow | undefined {
  return (
    eligibleWindows.find(
      (window) => window.gridTopRatio >= 0.56 && window.gridTopRatio <= 0.74,
    ) ??
    eligibleWindows.find(
      (window) => window.gridTopRatio >= 0.46 && window.gridTopRatio <= 0.72,
    ) ??
    eligibleWindows.at(-1)
  );
}

function getStructuredAnalysisWindows(raster: RasterImage): AnalysisWindow[] {
  const preferredWindow = selectPreferredStructuredWindow(
    getStructuredAnalysisWindowCandidates(raster),
  );

  return preferredWindow
    ? [
        {
          top: preferredWindow.top,
          height: preferredWindow.height,
        },
      ]
    : [];
}

function getPayorSignerIdentityWindow(
  raster: RasterImage,
): AnalysisWindow | undefined {
  const preferredWindow = selectPreferredStructuredWindow(
    getStructuredAnalysisWindowCandidates(raster),
  );
  if (!preferredWindow) {
    return undefined;
  }

  const identityHeight = Math.max(
    STRUCTURE_MIN_UPWARD_MARGIN_PIXELS * 2,
    Math.round(raster.height * STRUCTURE_IDENTITY_UPWARD_MARGIN_RATIO),
  );
  const top = Math.max(0, preferredWindow.gridTopY - identityHeight);
  return {
    top,
    height: Math.max(1, preferredWindow.gridTopY - top),
  };
}

function getStructuredRescueAnalysisWindows(
  raster: RasterImage,
): AnalysisWindow[] {
  const eligibleWindows = getStructuredAnalysisWindowCandidates(raster);
  const preferredWindow = selectPreferredStructuredWindow(eligibleWindows);
  if (!preferredWindow) {
    return [];
  }

  const preferredIndex = eligibleWindows.indexOf(preferredWindow);
  const rescueSources = [
    preferredWindow,
    ...(preferredIndex > 0 ? [eligibleWindows[preferredIndex - 1]] : []),
  ];
  const rescueHeight = Math.max(
    STRUCTURE_MIN_UPWARD_MARGIN_PIXELS * 2,
    Math.round(raster.height * STRUCTURE_IDENTITY_UPWARD_MARGIN_RATIO),
  );
  const seen = new Set<string>();

  return rescueSources.flatMap((window) => {
    const top = Math.max(0, window.gridTopY - rescueHeight);
    const height = Math.max(1, window.gridTopY - top);
    const key = `${top}:${height}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);

    return [{ top, height }];
  });
}

function getLowerCompactMarkRescueWindows(
  raster: RasterImage,
): AnalysisWindow[] {
  const top = Math.floor(raster.height * 0.72);
  const bottom = Math.min(raster.height, Math.ceil(raster.height * 0.96));

  if (bottom <= top) {
    return [];
  }

  return [
    {
      top,
      height: bottom - top,
    },
  ];
}

function getLowerSignerOverprintRescueWindows(
  raster: RasterImage,
): AnalysisWindow[] {
  const top = Math.floor(raster.height * 0.5);
  const bottom = Math.min(raster.height, Math.ceil(raster.height * 0.8));

  if (bottom <= top) {
    return [];
  }

  return [
    {
      top,
      height: bottom - top,
    },
  ];
}

function isRescueBandCandidate(
  component: Component,
  analysisHeight: number,
): boolean {
  return (
    component.maxY > analysisHeight * 0.18 &&
    component.minY < analysisHeight * 0.78
  );
}

function analyzeSignatureWindows(
  raster: RasterImage,
  windows: AnalysisWindow[],
  options: {
    rescueBand?: boolean;
    lowerCompactBand?: boolean;
    lowerSignerOverprintBand?: boolean;
  } = {},
) {
  if (options.lowerSignerOverprintBand) {
    const overprintAnalyses = windows.map((window) => {
      const analysisTop = Math.max(0, Math.min(window.top, raster.height - 1));
      const analysisHeight = Math.max(
        1,
        Math.min(window.height, raster.height - analysisTop),
      );
      const overprintMask = buildAnalysisMask(
        raster,
        225,
        analysisTop,
        analysisHeight,
        { localContrast: 16 },
      );
      const overprintComponents = getComponents(
        overprintMask.mask,
        raster.width,
        analysisHeight,
      );
      const blueInkMask = buildBlueInkMask(raster, analysisTop, analysisHeight);
      const blueInkComponents = getComponents(
        blueInkMask.mask,
        raster.width,
        analysisHeight,
      );
      const faintInkMask = buildRowContrastMask(
        raster,
        analysisTop,
        analysisHeight,
        {
          delta: 12,
          percentile: 0.5,
        },
      );
      const faintInkComponents = getComponents(
        faintInkMask.mask,
        raster.width,
        analysisHeight,
      );

      return {
        analysisTop,
        analysisHeight,
        darkPixelCount:
          overprintMask.darkPixelCount +
          blueInkMask.darkPixelCount +
          faintInkMask.darkPixelCount,
        candidates: [
          ...mergeOverprintedSignerInkFragments(
            overprintComponents,
            raster.width,
            analysisHeight,
          ).filter((candidate) => {
            const width = getComponentWidth(candidate);
            const height = getComponentHeight(candidate);

            return (
              width >= raster.width * 0.16 &&
              height >= Math.max(38, Math.round(analysisHeight * 0.16))
            );
          }),
          ...mergeColoredSignerInkFragments(
            blueInkComponents,
            raster.width,
            analysisHeight,
          ),
          ...findFaintLowerSignerInkComponents(
            faintInkComponents,
            raster.width,
            analysisHeight,
          ),
        ],
      };
    });
    const candidates = overprintAnalyses
      .flatMap((analysis) => analysis.candidates)
      .sort((left, right) => right.area - left.area);
    const largest = candidates[0];
    const largestWidth = largest ? largest.maxX - largest.minX + 1 : 0;
    const largestHeight = largest ? largest.maxY - largest.minY + 1 : 0;

    return {
      signaturePresent: candidates.length > 0,
      confidence: candidates.length > 0 ? 0.78 : 0,
      metrics: {
        darkPixelCount: overprintAnalyses.reduce(
          (total, analysis) => total + analysis.darkPixelCount,
          0,
        ),
        candidateCount: candidates.length,
        largestCandidateArea: largest?.area ?? 0,
        largestCandidateWidth: largestWidth,
        largestCandidateHeight: largestHeight,
        analysisWidth: raster.width,
        analysisHeight: overprintAnalyses.reduce(
          (total, analysis) => total + analysis.analysisHeight,
          0,
        ),
      },
    };
  }

  if (options.lowerCompactBand) {
    const compactAnalyses = windows.map((window) => {
      const analysisTop = Math.max(0, Math.min(window.top, raster.height - 1));
      const analysisHeight = Math.max(
        1,
        Math.min(window.height, raster.height - analysisTop),
      );
      const compactMask = buildAnalysisMask(
        raster,
        225,
        analysisTop,
        analysisHeight,
        { localContrast: 16 },
      );
      const compactComponents = getComponents(
        compactMask.mask,
        raster.width,
        analysisHeight,
      );

      return {
        analysisTop,
        analysisHeight,
        darkPixelCount: compactMask.darkPixelCount,
        candidates: mergeLowerCompactMarkFragments(
          compactComponents,
          raster.width,
          analysisHeight,
        ),
      };
    });
    const candidates = compactAnalyses
      .flatMap((analysis) => analysis.candidates)
      .sort((left, right) => right.area - left.area);
    const largest = candidates[0];
    const largestWidth = largest ? largest.maxX - largest.minX + 1 : 0;
    const largestHeight = largest ? largest.maxY - largest.minY + 1 : 0;

    return {
      signaturePresent: candidates.length > 0,
      confidence: candidates.length > 0 ? 0.78 : 0,
      metrics: {
        darkPixelCount: compactAnalyses.reduce(
          (total, analysis) => total + analysis.darkPixelCount,
          0,
        ),
        candidateCount: candidates.length,
        largestCandidateArea: largest?.area ?? 0,
        largestCandidateWidth: largestWidth,
        largestCandidateHeight: largestHeight,
        analysisWidth: raster.width,
        analysisHeight: compactAnalyses.reduce(
          (total, analysis) => total + analysis.analysisHeight,
          0,
        ),
      },
    };
  }

  const strongAnalyses = windows.map((window) => {
    const analysisTop = Math.max(0, Math.min(window.top, raster.height - 1));
    const analysisHeight = Math.max(
      1,
      Math.min(window.height, raster.height - analysisTop),
    );
    const strongMask = buildAnalysisMask(
      raster,
      145,
      analysisTop,
      analysisHeight,
    );
    const strongComponents = getComponents(
      strongMask.mask,
      raster.width,
      analysisHeight,
    );

    return {
      analysisTop,
      analysisHeight,
      darkPixelCount: strongMask.darkPixelCount,
      primaryCandidates: strongComponents.filter(
        (component) =>
          isSignatureCandidate(component) &&
          (!options.rescueBand ||
            isRescueBandCandidate(component, analysisHeight)),
      ),
      tallCandidates: strongComponents.filter((component) =>
        isTallSignatureCandidate(component, analysisHeight),
      ),
    };
  });
  const primaryCandidates = strongAnalyses.flatMap(
    (analysis) => analysis.primaryCandidates,
  );
  const tallCandidates = strongAnalyses.flatMap(
    (analysis) => analysis.tallCandidates,
  );
  const softCandidates =
    primaryCandidates.length > 0 || tallCandidates.length > 0
      ? []
      : strongAnalyses.flatMap((analysis) => {
          const softMask = buildAnalysisMask(
            raster,
            205,
            analysis.analysisTop,
            analysis.analysisHeight,
            { localContrast: 16 },
          );
          const softComponents = getComponents(
            softMask.mask,
            raster.width,
            analysis.analysisHeight,
          );
          const componentCandidates = softComponents.filter(
            (component) =>
              (isSignatureCandidate(component) ||
                isFaintSignatureCandidate(
                  component,
                  analysis.analysisHeight,
                )) &&
              (!options.rescueBand ||
                isRescueBandCandidate(component, analysis.analysisHeight)),
          );

          if (componentCandidates.length > 0) {
            return componentCandidates;
          }

          const relaxedComponents = getComponents(
            buildAnalysisMask(
              raster,
              225,
              analysis.analysisTop,
              analysis.analysisHeight,
              { localContrast: 16 },
            ).mask,
            raster.width,
            analysis.analysisHeight,
          );
          const looseCandidates = mergeLooseSignatureFragments(
            relaxedComponents,
            raster.width,
            analysis.analysisHeight,
          );
          if (looseCandidates.length > 0) {
            return looseCandidates;
          }

          const overprintedCandidates = mergeOverprintedSignerInkFragments(
            relaxedComponents,
            raster.width,
            analysis.analysisHeight,
          );
          if (overprintedCandidates.length > 0) {
            return overprintedCandidates;
          }

          return options.lowerCompactBand
            ? mergeLowerCompactMarkFragments(
                relaxedComponents,
                raster.width,
                analysis.analysisHeight,
              )
            : [];
        });
  const candidates = [
    ...primaryCandidates,
    ...tallCandidates,
    ...softCandidates,
  ].sort((left, right) => right.area - left.area);
  const largest = candidates[0];
  const largestWidth = largest ? largest.maxX - largest.minX + 1 : 0;
  const largestHeight = largest ? largest.maxY - largest.minY + 1 : 0;

  return {
    signaturePresent: candidates.length > 0,
    confidence:
      primaryCandidates.length > 0 ? 0.86 : candidates.length > 0 ? 0.78 : 0,
    metrics: {
      darkPixelCount: strongAnalyses.reduce(
        (total, analysis) => total + analysis.darkPixelCount,
        0,
      ),
      candidateCount: candidates.length,
      largestCandidateArea: largest?.area ?? 0,
      largestCandidateWidth: largestWidth,
      largestCandidateHeight: largestHeight,
      analysisWidth: raster.width,
      analysisHeight: strongAnalyses.reduce(
        (total, analysis) => total + analysis.analysisHeight,
        0,
      ),
    },
  };
}

export function analyzeSignatureRaster(raster: RasterImage) {
  const structuredWindows = getStructuredAnalysisWindows(raster);
  const signerIdentityWindow =
    getPayorSignerIdentityWindow(raster) ?? structuredWindows[0];
  const windows =
    structuredWindows.length > 0
      ? structuredWindows
      : getFallbackAnalysisWindows(raster);
  let analysis = analyzeSignatureWindows(raster, windows);
  let analysisWindowCount = windows.length;

  if (!analysis.signaturePresent && structuredWindows.length > 0) {
    const rescueWindows = getStructuredRescueAnalysisWindows(raster);
    const rescueAnalysis = analyzeSignatureWindows(raster, rescueWindows, {
      rescueBand: true,
    });
    if (rescueAnalysis.signaturePresent) {
      analysis = rescueAnalysis;
      analysisWindowCount = windows.length + rescueWindows.length;
    }
  }

  if (!analysis.signaturePresent) {
    const lowerOverprintWindows = getLowerSignerOverprintRescueWindows(raster);
    const lowerOverprintAnalysis = analyzeSignatureWindows(
      raster,
      lowerOverprintWindows,
      {
        lowerSignerOverprintBand: true,
      },
    );
    if (lowerOverprintAnalysis.signaturePresent) {
      analysis = lowerOverprintAnalysis;
      analysisWindowCount += lowerOverprintWindows.length;
    }
  }

  if (!analysis.signaturePresent && structuredWindows.length > 0) {
    const lowerCompactWindows = getLowerCompactMarkRescueWindows(raster);
    const lowerCompactAnalysis = analyzeSignatureWindows(
      raster,
      lowerCompactWindows,
      {
        lowerCompactBand: true,
      },
    );
    if (lowerCompactAnalysis.signaturePresent) {
      analysis = lowerCompactAnalysis;
      analysisWindowCount += lowerCompactWindows.length;
    }
  }

  return {
    ...analysis,
    signerWindow: signerIdentityWindow,
    structure: {
      payorSignerBandVisible: structuredWindows.length > 0,
      structuredWindowCount: structuredWindows.length,
      analysisWindowCount,
    },
  };
}

export function createSignatureVisualDetector(
  config: SignatureVisualDetectorConfig,
): SignatureVisualDetector {
  const dpi = toPositiveInteger(config.dpi, 300);
  const timeoutMs = toPositiveInteger(config.timeoutMs, 60000);

  return {
    async detect(input): Promise<SignatureVisualDetectionResult> {
      const started = Date.now();
      const dir = await mkdtemp(join(tmpdir(), "taxgenie-signature-render-"));
      const inputPath = join(dir, "page.pdf");
      const outputPrefix = join(dir, "signature");

      try {
        await writeFile(inputPath, input.content);
        await execFileAsync(
          "pdftoppm",
          ["-r", String(dpi), inputPath, outputPrefix],
          {
            maxBuffer: 100 * 1024 * 1024,
            timeout: timeoutMs,
          },
        );

        const files = await readdir(dir);
        const ppmFile = files
          .filter((file) => file.toLowerCase().endsWith(".ppm"))
          .sort()[0];
        if (!ppmFile) {
          throw new Error("PDF signature render did not produce a PPM");
        }

        const renderedPageRaster = parsePpm(await readFile(join(dir, ppmFile)));
        const analyzedOrientations = getSignaturePageOrientations(
          renderedPageRaster,
        ).map((orientation) => {
          const crop = getPayorSignatureCropBounds(orientation.raster);
          const analysis = analyzeSignatureRaster(
            cropRaster(orientation.raster, crop),
          );
          const score =
            (analysis.structure.payorSignerBandVisible ? 100 : 0) +
            (analysis.signaturePresent ? 10 : 0) +
            analysis.structure.structuredWindowCount +
            analysis.confidence;
          return { ...orientation, crop, analysis, score };
        });
        const normalizedPage = analyzedOrientations.reduce((best, candidate) =>
          candidate.score > best.score ? candidate : best,
        );
        const pageRaster = normalizedPage.raster;
        const crop = normalizedPage.crop;
        const analysis = normalizedPage.analysis;
        const normalizedSignerWindow = analysis.signerWindow
          ? {
              x: crop.x,
              y: crop.y + analysis.signerWindow.top,
              width: crop.width,
              height: analysis.signerWindow.height,
            }
          : undefined;
        const originalSignerWindow = normalizedSignerWindow
          ? mapNormalizedRectToOriginal(
              normalizedSignerWindow,
              renderedPageRaster,
              normalizedPage.rotationApplied,
            )
          : undefined;
        const payorSignerWindow = originalSignerWindow
          ? {
              normalized: normalizePixelRect(
                originalSignerWindow,
                renderedPageRaster,
              ),
              pixels: originalSignerWindow,
            }
          : undefined;
        const signerRecoveryEligible =
          analysis.signaturePresent ||
          analysis.structure.payorSignerBandVisible;
        const signerRecoveryReason = analysis.signaturePresent
          ? "visual_signature_detected"
          : analysis.structure.payorSignerBandVisible
            ? "payor_signer_band_visible"
            : undefined;

        return {
          status: analysis.signaturePresent ? "detected" : "not_detected",
          signaturePresent: analysis.signaturePresent,
          confidence: analysis.confidence,
          signerRecoveryEligible,
          signerRecoveryReason,
          structure: {
            ...analysis.structure,
            payorSignerWindow,
          },
          metrics: analysis.metrics,
          render: {
            dpi,
            elapsedMs: Date.now() - started,
            cropPixels: crop,
            pagePixels: {
              width: pageRaster.width,
              height: pageRaster.height,
            },
            originalPagePixels: {
              width: renderedPageRaster.width,
              height: renderedPageRaster.height,
            },
            rotationApplied: normalizedPage.rotationApplied,
          },
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
