import {
  MAX_SIGNATURE_IMAGE_BYTES,
  MAX_SIGNATURE_IMAGE_PIXELS,
} from '@/lib/signing-module'

const SUPPORTED_SIGNATURE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])
const CORNER_SAMPLE_RATIO = 0.08
const MIN_CORNER_SAMPLE_SIZE = 4
const MAX_CORNER_SAMPLE_SIZE = 24
const MIN_BACKGROUND_CHANNEL = 220
const MIN_BACKGROUND_AVERAGE = 235
const MAX_BACKGROUND_CHANNEL_SPREAD = 30
const MAX_BACKGROUND_VARIATION = 20
const TRANSPARENT_ALPHA_THRESHOLD = 250
const TRANSPARENT_PIXEL_FRACTION = 0.05
const BACKGROUND_NOISE_FLOOR = 10 / 255
const CONTENT_ALPHA_THRESHOLD = 8
const MIN_CONTENT_PIXELS = 20
const MIN_CONTENT_DIMENSION = 4
const MIN_OUTPUT_PADDING = 4
const MAX_OUTPUT_PADDING = 24
const OUTPUT_PADDING_RATIO = 0.04

type PixelBuffer = {
  data: Uint8ClampedArray
  height: number
  width: number
}

type RgbaColor = [number, number, number, number]
type RgbColor = [number, number, number]

export type NormalizedSignaturePixels = PixelBuffer & {
  backgroundRemoved: boolean
}

export type NormalizedSignatureImage = {
  backgroundRemoved: boolean
  dataUrl: string
  height: number
  mimeType: 'image/png'
  width: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const getMedian = (values: Array<number>) => {
  if (values.length === 0) {
    return 0
  }

  const sorted = values.slice().sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

const getPixel = (pixels: PixelBuffer, x: number, y: number): RgbaColor => {
  const offset = (y * pixels.width + x) * 4

  return [
    pixels.data[offset] ?? 0,
    pixels.data[offset + 1] ?? 0,
    pixels.data[offset + 2] ?? 0,
    pixels.data[offset + 3] ?? 0,
  ]
}

const getCornerBounds = (
  width: number,
  height: number,
): Array<{ endX: number; endY: number; startX: number; startY: number }> => {
  const sampleSize = clamp(
    Math.round(Math.min(width, height) * CORNER_SAMPLE_RATIO),
    MIN_CORNER_SAMPLE_SIZE,
    Math.min(MAX_CORNER_SAMPLE_SIZE, width, height),
  )

  return [
    { startX: 0, startY: 0, endX: sampleSize, endY: sampleSize },
    {
      startX: width - sampleSize,
      startY: 0,
      endX: width,
      endY: sampleSize,
    },
    {
      startX: 0,
      startY: height - sampleSize,
      endX: sampleSize,
      endY: height,
    },
    {
      startX: width - sampleSize,
      startY: height - sampleSize,
      endX: width,
      endY: height,
    },
  ]
}

const getCornerSamples = (pixels: PixelBuffer) =>
  getCornerBounds(pixels.width, pixels.height).map((bounds) => {
    const red: Array<number> = []
    const green: Array<number> = []
    const blue: Array<number> = []
    const alpha: Array<number> = []

    for (let y = bounds.startY; y < bounds.endY; y += 1) {
      for (let x = bounds.startX; x < bounds.endX; x += 1) {
        const [pixelRed, pixelGreen, pixelBlue, pixelAlpha] = getPixel(
          pixels,
          x,
          y,
        )
        red.push(pixelRed)
        green.push(pixelGreen)
        blue.push(pixelBlue)
        alpha.push(pixelAlpha)
      }
    }

    return [
      getMedian(red),
      getMedian(green),
      getMedian(blue),
      getMedian(alpha),
    ] as RgbaColor
  })

const hasTransparentBackground = (
  pixels: PixelBuffer,
  cornerSamples: Array<RgbaColor>,
) => {
  const transparentCorners = cornerSamples.filter(
    ([, , , alpha]) => alpha < TRANSPARENT_ALPHA_THRESHOLD,
  ).length

  if (transparentCorners >= 3) {
    return true
  }

  const requiredTransparentPixels = Math.max(
    1,
    Math.ceil(pixels.width * pixels.height * TRANSPARENT_PIXEL_FRACTION),
  )
  let transparentPixels = 0

  for (let offset = 3; offset < pixels.data.length; offset += 4) {
    if ((pixels.data[offset] ?? 255) < TRANSPARENT_ALPHA_THRESHOLD) {
      transparentPixels += 1
      if (transparentPixels >= requiredTransparentPixels) {
        return true
      }
    }
  }

  return false
}

const isNearWhite = ([red, green, blue]: RgbColor) => {
  const minimum = Math.min(red, green, blue)
  const maximum = Math.max(red, green, blue)
  const average = (red + green + blue) / 3

  return (
    minimum >= MIN_BACKGROUND_CHANNEL &&
    average >= MIN_BACKGROUND_AVERAGE &&
    maximum - minimum <= MAX_BACKGROUND_CHANNEL_SPREAD
  )
}

const estimateBackground = (cornerSamples: Array<RgbaColor>): RgbColor => {
  const lightCorners = cornerSamples
    .map(([red, green, blue]) => [red, green, blue] as RgbColor)
    .filter(isNearWhite)

  if (lightCorners.length < 3) {
    throw new Error(
      'Use a signature on a plain white background or upload a transparent PNG.',
    )
  }

  const background: RgbColor = [
    getMedian(lightCorners.map(([red]) => red)),
    getMedian(lightCorners.map(([, green]) => green)),
    getMedian(lightCorners.map(([, , blue]) => blue)),
  ]

  const unevenBackground = lightCorners.some((corner) =>
    corner.some(
      (channel, channelIndex) =>
        Math.abs(channel - (background[channelIndex] ?? channel)) >
        MAX_BACKGROUND_VARIATION,
    ),
  )

  if (unevenBackground) {
    throw new Error(
      'The signature background is uneven. Use an evenly lit white background or a transparent PNG.',
    )
  }

  return background
}

const removeLightBackground = (pixels: PixelBuffer, background: RgbColor) => {
  const output = new Uint8ClampedArray(pixels.data.length)

  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const sourceRed = pixels.data[offset] ?? 0
    const sourceGreen = pixels.data[offset + 1] ?? 0
    const sourceBlue = pixels.data[offset + 2] ?? 0
    const sourceAlpha = (pixels.data[offset + 3] ?? 255) / 255
    const channels = [sourceRed, sourceGreen, sourceBlue]
    let coverage = 0

    for (let channelIndex = 0; channelIndex < 3; channelIndex += 1) {
      const backgroundChannel = background[channelIndex] ?? 255
      const sourceChannel = channels[channelIndex] ?? backgroundChannel
      coverage = Math.max(
        coverage,
        Math.max(0, backgroundChannel - sourceChannel) /
          Math.max(backgroundChannel, 1),
      )
    }

    const adjustedCoverage = clamp(
      (coverage - BACKGROUND_NOISE_FLOOR) / (1 - BACKGROUND_NOISE_FLOOR),
      0,
      1,
    )
    const outputAlpha = adjustedCoverage * sourceAlpha

    if (outputAlpha * 255 <= CONTENT_ALPHA_THRESHOLD || coverage === 0) {
      continue
    }

    for (let channelIndex = 0; channelIndex < 3; channelIndex += 1) {
      const backgroundChannel = background[channelIndex] ?? 255
      const sourceChannel = channels[channelIndex] ?? backgroundChannel
      const foregroundChannel =
        (sourceChannel - (1 - coverage) * backgroundChannel) / coverage
      output[offset + channelIndex] = clamp(
        Math.round(foregroundChannel),
        0,
        255,
      )
    }
    output[offset + 3] = Math.round(outputAlpha * 255)
  }

  return output
}

const cropSignaturePixels = (pixels: PixelBuffer) => {
  let minX = pixels.width
  let minY = pixels.height
  let maxX = -1
  let maxY = -1
  let contentPixels = 0

  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      const alpha = pixels.data[(y * pixels.width + x) * 4 + 3] ?? 0
      if (alpha <= CONTENT_ALPHA_THRESHOLD) {
        continue
      }

      contentPixels += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  const contentWidth = maxX - minX + 1
  const contentHeight = maxY - minY + 1
  if (
    contentPixels < MIN_CONTENT_PIXELS ||
    contentWidth < MIN_CONTENT_DIMENSION ||
    contentHeight < MIN_CONTENT_DIMENSION
  ) {
    throw new Error(
      'No clear signature strokes were detected. Use a darker signature on a plain white background.',
    )
  }

  const padding = clamp(
    Math.round(Math.max(contentWidth, contentHeight) * OUTPUT_PADDING_RATIO),
    MIN_OUTPUT_PADDING,
    MAX_OUTPUT_PADDING,
  )
  const outputWidth = contentWidth + padding * 2
  const outputHeight = contentHeight + padding * 2
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4)

  for (let y = 0; y < contentHeight; y += 1) {
    const sourceOffset = ((minY + y) * pixels.width + minX) * 4
    const targetOffset = ((padding + y) * outputWidth + padding) * 4
    output.set(
      pixels.data.subarray(sourceOffset, sourceOffset + contentWidth * 4),
      targetOffset,
    )
  }

  return {
    data: output,
    height: outputHeight,
    width: outputWidth,
  }
}

export const validateSignatureImageFile = (
  file: Pick<File, 'size' | 'type'>,
) => {
  if (!SUPPORTED_SIGNATURE_IMAGE_TYPES.has(file.type)) {
    throw new Error('Signature image must be a PNG or JPEG file.')
  }

  if (file.size === 0) {
    throw new Error('The selected signature image is empty.')
  }

  if (file.size > MAX_SIGNATURE_IMAGE_BYTES) {
    throw new Error('Signature image must be 3 MB or smaller.')
  }
}

export const normalizeSignaturePixels = (
  pixels: PixelBuffer,
): NormalizedSignaturePixels => {
  if (
    !Number.isInteger(pixels.width) ||
    !Number.isInteger(pixels.height) ||
    pixels.width <= 0 ||
    pixels.height <= 0
  ) {
    throw new Error('Unable to read the signature image dimensions.')
  }

  const pixelCount = pixels.width * pixels.height
  if (pixelCount > MAX_SIGNATURE_IMAGE_PIXELS) {
    throw new Error('Signature image must contain 12 megapixels or fewer.')
  }

  if (pixels.data.length !== pixelCount * 4) {
    throw new Error('Unable to read the signature image pixels.')
  }

  const cornerSamples = getCornerSamples(pixels)
  const alreadyTransparent = hasTransparentBackground(pixels, cornerSamples)
  const normalizedData = alreadyTransparent
    ? new Uint8ClampedArray(pixels.data)
    : removeLightBackground(pixels, estimateBackground(cornerSamples))
  const cropped = cropSignaturePixels({
    data: normalizedData,
    height: pixels.height,
    width: pixels.width,
  })

  return {
    ...cropped,
    backgroundRemoved: !alreadyTransparent,
  }
}

const fileToDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Unable to read the selected signature image.'))
    }
    reader.onerror = () =>
      reject(new Error('Unable to read the selected signature image.'))
    reader.readAsDataURL(file)
  })

const loadImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error('Unable to decode the selected signature image.'))
    image.src = dataUrl
  })

const canvasToPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }

      reject(new Error('Unable to create the transparent signature PNG.'))
    }, 'image/png')
  })

const readCanvasPixels = (canvas: HTMLCanvasElement): PixelBuffer => {
  const context = canvas.getContext('2d', {
    willReadFrequently: true,
  })
  if (!context) {
    throw new Error('Signature image processing is unavailable.')
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  return {
    data: imageData.data,
    height: imageData.height,
    width: imageData.width,
  }
}

const renderNormalizedPixels = (pixels: NormalizedSignaturePixels) => {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Signature image processing is unavailable.')
  }

  const imageData = context.createImageData(pixels.width, pixels.height)
  imageData.data.set(pixels.data)
  context.putImageData(imageData, 0, 0)

  return canvas
}

const getPngDataUrlByteLength = (dataUrl: string) => {
  const base64 = dataUrl.split(',', 2)[1] ?? ''
  const paddingLength = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0

  return Math.max(0, Math.floor((base64.length * 3) / 4) - paddingLength)
}

export const normalizeSignatureCanvas = (
  canvas: HTMLCanvasElement,
): NormalizedSignatureImage => {
  const normalized = normalizeSignaturePixels(readCanvasPixels(canvas))
  const outputCanvas = renderNormalizedPixels(normalized)
  const dataUrl = outputCanvas.toDataURL('image/png')

  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Unable to create the transparent signature PNG.')
  }

  if (getPngDataUrlByteLength(dataUrl) > MAX_SIGNATURE_IMAGE_BYTES) {
    throw new Error('The processed signature PNG must be 3 MB or smaller.')
  }

  return {
    backgroundRemoved: normalized.backgroundRemoved,
    dataUrl,
    height: normalized.height,
    mimeType: 'image/png',
    width: normalized.width,
  }
}

export const normalizeSignatureImageFile = async (
  file: File,
): Promise<NormalizedSignatureImage> => {
  validateSignatureImageFile(file)

  const sourceDataUrl = await fileToDataUrl(file)
  const image = await loadImage(sourceDataUrl)
  const pixelCount = image.naturalWidth * image.naturalHeight
  if (pixelCount > MAX_SIGNATURE_IMAGE_PIXELS) {
    throw new Error('Signature image must contain 12 megapixels or fewer.')
  }

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.naturalWidth
  sourceCanvas.height = image.naturalHeight
  const sourceContext = sourceCanvas.getContext('2d', {
    willReadFrequently: true,
  })
  if (!sourceContext) {
    throw new Error('Signature image processing is unavailable.')
  }

  sourceContext.drawImage(image, 0, 0)
  const normalized = normalizeSignaturePixels(readCanvasPixels(sourceCanvas))
  const outputCanvas = renderNormalizedPixels(normalized)

  const outputBlob = await canvasToPng(outputCanvas)
  if (outputBlob.size > MAX_SIGNATURE_IMAGE_BYTES) {
    throw new Error('The processed signature PNG must be 3 MB or smaller.')
  }

  return {
    backgroundRemoved: normalized.backgroundRemoved,
    dataUrl: await fileToDataUrl(outputBlob),
    height: normalized.height,
    mimeType: 'image/png',
    width: normalized.width,
  }
}
