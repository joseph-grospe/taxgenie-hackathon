import type { SignatureRect } from '@/lib/signing-module'

type RectLike = {
  x: number
  y: number
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const SIGNATURE_CAPTION_WIDTH_RATIO = 0.68
const SIGNATURE_IMAGE_LEFT_RATIO = 0.72
const SIGNATURE_IMAGE_WIDTH_RATIO = 0.28
const SIGNATURE_IMAGE_VERTICAL_PADDING_RATIO = 0.12
const AUTO_TEXT_BLOCK_CHAR_WIDTH = 0.0084
const AUTO_TEXT_BLOCK_HORIZONTAL_PADDING = 0.02
const AUTO_TEXT_BLOCK_VERTICAL_PADDING = 0.012
const AUTO_TEXT_BLOCK_MIN_WIDTH = 0.3
const AUTO_TEXT_BLOCK_MAX_WIDTH = 0.9
const AUTO_TEXT_BLOCK_MIN_HEIGHT = 0.046

const normalizeCaptionText = (text: string) =>
  text.replace(/\s+/gu, ' ').trim() || 'Name / Designation / TIN'

export const getSignatureImageRect = (
  blockRect: SignatureRect,
): SignatureRect => ({
  x: clamp(blockRect.x + blockRect.width * SIGNATURE_IMAGE_LEFT_RATIO, 0, 1),
  y: clamp(
    blockRect.y + blockRect.height * SIGNATURE_IMAGE_VERTICAL_PADDING_RATIO,
    0,
    1,
  ),
  width: clamp(blockRect.width * SIGNATURE_IMAGE_WIDTH_RATIO, 0.01, 1),
  height: clamp(
    blockRect.height * (1 - SIGNATURE_IMAGE_VERTICAL_PADDING_RATIO * 2),
    0.01,
    1,
  ),
})

export const getSignatureCaptionRect = (
  blockRect: SignatureRect,
): SignatureRect => ({
  x: blockRect.x,
  y: blockRect.y,
  width: clamp(blockRect.width * SIGNATURE_CAPTION_WIDTH_RATIO, 0.01, 1),
  height: blockRect.height,
})

export const fitRectWithinRect = <TRect extends RectLike>(
  container: TRect,
  intrinsicWidth: number,
  intrinsicHeight: number,
): TRect => {
  if (
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return container
  }

  const containerAspect = container.width / container.height
  const imageAspect = intrinsicWidth / intrinsicHeight

  if (imageAspect >= containerAspect) {
    const width = container.width
    const height = width / imageAspect

    return {
      ...container,
      y: container.y + container.height - height,
      width,
      height,
    }
  }

  const height = container.height
  const width = height * imageAspect

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
    estimatedCaptionWidth / SIGNATURE_CAPTION_WIDTH_RATIO,
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

export const getAutoTextBlockRect = (
  placement: SignatureRect,
  text: string,
): SignatureRect => {
  const autoSize = getAutoTextBlockSize(text)

  return {
    ...placement,
    ...autoSize,
    x: clamp(placement.x, 0, 1 - autoSize.width),
    y: clamp(placement.y, 0, 1 - autoSize.height),
  }
}

export const getDefaultSignatureImageRect = (
  blockRect: SignatureRect,
  intrinsicWidth: number,
  intrinsicHeight: number,
) =>
  fitRectWithinRect(
    getSignatureImageRect(blockRect),
    intrinsicWidth,
    intrinsicHeight,
  )
