import type { SignatureRect } from '@/lib/signing-module'

type RectLike = {
  x: number
  y: number
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const SIGNATURE_NAME_LEFT_RATIO = 0
const SIGNATURE_NAME_WIDTH_RATIO = 0.4
const SIGNATURE_FIRST_SEPARATOR_LEFT_RATIO = 0.4
const SIGNATURE_SEPARATOR_WIDTH_RATIO = 0.02
const SIGNATURE_DESIGNATION_LEFT_RATIO = 0.42
const SIGNATURE_DESIGNATION_WIDTH_RATIO = 0.32
const SIGNATURE_SECOND_SEPARATOR_LEFT_RATIO = 0.74
const SIGNATURE_TIN_LEFT_RATIO = 0.76
const SIGNATURE_TIN_WIDTH_RATIO = 0.24
const SIGNATURE_CAPTION_TOP_RATIO = 0.6
const SIGNATURE_IMAGE_WIDTH_RATIO = 0.34
const SIGNATURE_IMAGE_OVERLAP_RATIO = 0.25
const SIGNATURE_IMAGE_MAX_HEIGHT_RATIO =
  SIGNATURE_CAPTION_TOP_RATIO / (1 - SIGNATURE_IMAGE_OVERLAP_RATIO)
const AUTO_TEXT_BLOCK_CONTENT_WIDTH_RATIO = 0.7
const AUTO_TEXT_BLOCK_CHAR_WIDTH = 0.0084
const AUTO_TEXT_BLOCK_HORIZONTAL_PADDING = 0.02
const AUTO_TEXT_BLOCK_VERTICAL_PADDING = 0.012
const AUTO_TEXT_BLOCK_MIN_WIDTH = 0.3
const AUTO_TEXT_BLOCK_MAX_WIDTH = 0.9
const AUTO_TEXT_BLOCK_MIN_HEIGHT = 0.046
const SIGNATURE_TEXT_FONT_SIZE_RATIO = 1 / 7.92
const SIGNATURE_TEXT_FONT_SIZE_MIN = 4
const SIGNATURE_TEXT_FONT_SIZE_MAX = 10

const normalizeCaptionText = (text: string) =>
  text.replace(/\s+/gu, ' ').trim() || 'Name / Designation / TIN'

export const getSignatureCaptionRect = (
  blockRect: SignatureRect,
): SignatureRect => ({
  x: blockRect.x,
  y: clamp(blockRect.y + blockRect.height * SIGNATURE_CAPTION_TOP_RATIO, 0, 1),
  width: blockRect.width,
  height: clamp(blockRect.height * (1 - SIGNATURE_CAPTION_TOP_RATIO), 0.01, 1),
})

const getInlineTextRect = (
  captionRect: SignatureRect,
  relativeX: number,
  relativeWidth: number,
): SignatureRect => ({
  x: clamp(captionRect.x + relativeX * captionRect.width, 0, 1),
  y: captionRect.y,
  width: clamp(relativeWidth * captionRect.width, 0.01, 1),
  height: captionRect.height,
})

export const getSignatureCaptionLayoutRects = (blockRect: SignatureRect) => {
  const captionRect = getSignatureCaptionRect(blockRect)

  return {
    nameRect: getInlineTextRect(
      captionRect,
      SIGNATURE_NAME_LEFT_RATIO,
      SIGNATURE_NAME_WIDTH_RATIO,
    ),
    firstSeparatorRect: getInlineTextRect(
      captionRect,
      SIGNATURE_FIRST_SEPARATOR_LEFT_RATIO,
      SIGNATURE_SEPARATOR_WIDTH_RATIO,
    ),
    designationRect: getInlineTextRect(
      captionRect,
      SIGNATURE_DESIGNATION_LEFT_RATIO,
      SIGNATURE_DESIGNATION_WIDTH_RATIO,
    ),
    secondSeparatorRect: getInlineTextRect(
      captionRect,
      SIGNATURE_SECOND_SEPARATOR_LEFT_RATIO,
      SIGNATURE_SEPARATOR_WIDTH_RATIO,
    ),
    tinRect: getInlineTextRect(
      captionRect,
      SIGNATURE_TIN_LEFT_RATIO,
      SIGNATURE_TIN_WIDTH_RATIO,
    ),
  }
}

export const getSignatureCaptionFieldRects = (blockRect: SignatureRect) => {
  const { nameRect, designationRect, tinRect } =
    getSignatureCaptionLayoutRects(blockRect)

  return { nameRect, designationRect, tinRect }
}

export const getSignatureImageRect = (
  blockRect: SignatureRect,
): SignatureRect => {
  const { designationRect } = getSignatureCaptionLayoutRects(blockRect)
  const width = clamp(
    blockRect.width * SIGNATURE_IMAGE_WIDTH_RATIO,
    0.01,
    blockRect.width,
  )
  const designationCenter = designationRect.x + designationRect.width / 2

  return {
    x: clamp(
      designationCenter - width / 2,
      blockRect.x,
      blockRect.x + blockRect.width - width,
    ),
    y: blockRect.y,
    width,
    height: clamp(
      blockRect.height * SIGNATURE_IMAGE_MAX_HEIGHT_RATIO,
      0.01,
      blockRect.height,
    ),
  }
}

export const getSignatureTextFontSize = (
  captionRect: SignatureRect,
  pageHeight: number,
) =>
  clamp(
    captionRect.height * pageHeight * SIGNATURE_TEXT_FONT_SIZE_RATIO,
    SIGNATURE_TEXT_FONT_SIZE_MIN,
    SIGNATURE_TEXT_FONT_SIZE_MAX,
  )

export const fitRectWithinRect = <TRect extends RectLike>(
  container: TRect,
  intrinsicWidth: number,
  intrinsicHeight: number,
  coordinateWidth = 1,
  coordinateHeight = 1,
): TRect => {
  if (
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0 ||
    container.width <= 0 ||
    container.height <= 0 ||
    coordinateWidth <= 0 ||
    coordinateHeight <= 0
  ) {
    return container
  }

  const containerAspect =
    (container.width * coordinateWidth) / (container.height * coordinateHeight)
  const imageAspect = intrinsicWidth / intrinsicHeight

  if (imageAspect >= containerAspect) {
    const width = container.width
    const height = (width * coordinateWidth) / imageAspect / coordinateHeight

    return {
      ...container,
      y: container.y + container.height - height,
      width,
      height,
    }
  }

  const height = container.height
  const width = (height * coordinateHeight * imageAspect) / coordinateWidth

  return {
    ...container,
    x: container.x,
    y: container.y + container.height - height,
    width,
    height,
  }
}

export const getAutoTextBlockSize = (
  text: string,
): Pick<SignatureRect, 'width' | 'height'> => {
  const normalizedText = normalizeCaptionText(text)
  const estimatedCaptionWidth =
    normalizedText.length * AUTO_TEXT_BLOCK_CHAR_WIDTH +
    AUTO_TEXT_BLOCK_HORIZONTAL_PADDING * 2
  const estimatedWidth = clamp(
    estimatedCaptionWidth / AUTO_TEXT_BLOCK_CONTENT_WIDTH_RATIO,
    AUTO_TEXT_BLOCK_MIN_WIDTH,
    AUTO_TEXT_BLOCK_MAX_WIDTH,
  )
  const estimatedHeight =
    AUTO_TEXT_BLOCK_MIN_HEIGHT + AUTO_TEXT_BLOCK_VERTICAL_PADDING * 2

  return {
    width: estimatedWidth,
    height: estimatedHeight,
  }
}

export const getScaledAutoTextBlockSize = (
  text: string,
  scale = 1,
): Pick<SignatureRect, 'width' | 'height'> => {
  const autoSize = getAutoTextBlockSize(text)
  const normalizedScale = Number.isFinite(scale) ? Math.max(scale, 0.01) : 1

  return {
    width: clamp(autoSize.width * normalizedScale, 0.01, 1),
    height: clamp(autoSize.height * normalizedScale, 0.01, 1),
  }
}

export const getAutoTextBlockRect = (
  placement: SignatureRect,
  text: string,
  scale = 1,
): SignatureRect => {
  const autoSize = getScaledAutoTextBlockSize(text, scale)
  const centerX = placement.x + placement.width / 2
  const centerY = placement.y + placement.height / 2

  return {
    ...placement,
    ...autoSize,
    x: clamp(centerX - autoSize.width / 2, 0, 1 - autoSize.width),
    y: clamp(centerY - autoSize.height / 2, 0, 1 - autoSize.height),
  }
}

export const getDefaultSignatureImageRect = (
  blockRect: SignatureRect,
  intrinsicWidth: number,
  intrinsicHeight: number,
  coordinateWidth = 1,
  coordinateHeight = 1,
) => {
  const container = getSignatureImageRect(blockRect)
  const captionRect = getSignatureCaptionRect(blockRect)
  const fittedRect = fitRectWithinRect(
    container,
    intrinsicWidth,
    intrinsicHeight,
    coordinateWidth,
    coordinateHeight,
  )
  const containerCenter = container.x + container.width / 2

  return {
    ...fittedRect,
    x: clamp(
      containerCenter - fittedRect.width / 2,
      blockRect.x,
      blockRect.x + blockRect.width - fittedRect.width,
    ),
    y: clamp(
      captionRect.y - fittedRect.height * (1 - SIGNATURE_IMAGE_OVERLAP_RATIO),
      blockRect.y,
      blockRect.y + blockRect.height - fittedRect.height,
    ),
  }
}
