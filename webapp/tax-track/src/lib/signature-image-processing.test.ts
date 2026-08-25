/* @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import {
  normalizeSignatureCanvas,
  normalizeSignaturePixels,
  validateSignatureImageFile,
} from '@/lib/signature-image-processing'

const buildPixels = (
  width: number,
  height: number,
  color: [number, number, number, number],
) => {
  const data = new Uint8ClampedArray(width * height * 4)

  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(color, offset)
  }

  return { data, height, width }
}

const setPixel = (
  pixels: ReturnType<typeof buildPixels>,
  x: number,
  y: number,
  color: [number, number, number, number],
) => {
  pixels.data.set(color, (y * pixels.width + x) * 4)
}

const drawStroke = (
  pixels: ReturnType<typeof buildPixels>,
  color: [number, number, number, number],
) => {
  for (let y = 8; y < 12; y += 1) {
    for (let x = 8; x < 24; x += 1) {
      setPixel(pixels, x, y, color)
    }
  }
}

const getVisiblePixels = (data: Uint8ClampedArray) => {
  const visible: Array<[number, number, number, number]> = []

  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] ?? 0
    if (alpha > 8) {
      visible.push([
        data[offset] ?? 0,
        data[offset + 1] ?? 0,
        data[offset + 2] ?? 0,
        alpha,
      ])
    }
  }

  return visible
}

describe('signature image processing', () => {
  it('removes an opaque white background and feathers antialiased strokes', () => {
    const pixels = buildPixels(32, 20, [255, 255, 255, 255])
    drawStroke(pixels, [15, 15, 15, 255])
    for (let x = 8; x < 24; x += 1) {
      setPixel(pixels, x, 7, [190, 190, 190, 255])
    }

    const result = normalizeSignaturePixels(pixels)
    const visible = getVisiblePixels(result.data)

    expect(result.backgroundRemoved).toBe(true)
    expect(result.width).toBeLessThan(pixels.width)
    expect(result.height).toBeLessThan(pixels.height)
    expect(visible.some(([, , , alpha]) => alpha > 0 && alpha < 255)).toBe(true)
    expect(
      result.data.filter((_, index) => index % 4 === 3 && _ === 0).length,
    ).toBeGreaterThan(0)
  })

  it('accepts an evenly lit off-white background', () => {
    const pixels = buildPixels(32, 20, [248, 246, 242, 255])
    drawStroke(pixels, [25, 25, 25, 255])

    expect(normalizeSignaturePixels(pixels).backgroundRemoved).toBe(true)
  })

  it('preserves colored ink while removing the background', () => {
    const pixels = buildPixels(32, 20, [255, 255, 255, 255])
    drawStroke(pixels, [25, 80, 190, 255])

    const visible = getVisiblePixels(normalizeSignaturePixels(pixels).data)
    const strongestBluePixel = visible
      .slice()
      .sort((left, right) => right[2] - right[0] - (left[2] - left[0]))[0]

    expect(strongestBluePixel[2]).toBeGreaterThan(strongestBluePixel[0])
  })

  it('preserves an existing transparent background and crops whitespace', () => {
    const pixels = buildPixels(40, 24, [0, 0, 0, 0])
    drawStroke(pixels, [20, 60, 180, 255])

    const result = normalizeSignaturePixels(pixels)
    const visible = getVisiblePixels(result.data)

    expect(result.backgroundRemoved).toBe(false)
    expect(result.width).toBeLessThan(pixels.width)
    expect(result.height).toBeLessThan(pixels.height)
    expect(visible[0]?.slice(0, 3)).toEqual([20, 60, 180])
  })

  it('rejects dark, uneven, and blank backgrounds', () => {
    const dark = buildPixels(32, 20, [90, 90, 90, 255])
    drawStroke(dark, [10, 10, 10, 255])
    expect(() => normalizeSignaturePixels(dark)).toThrow('plain white')

    const uneven = buildPixels(32, 20, [255, 255, 255, 255])
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        setPixel(uneven, x, y, [210, 210, 210, 255])
        setPixel(uneven, 31 - x, 19 - y, [210, 210, 210, 255])
      }
    }
    drawStroke(uneven, [10, 10, 10, 255])
    expect(() => normalizeSignaturePixels(uneven)).toThrow('plain white')

    const blank = buildPixels(32, 20, [255, 255, 255, 255])
    expect(() => normalizeSignaturePixels(blank)).toThrow(
      'No clear signature strokes',
    )
  })

  it('enforces source type, byte, and pixel limits', () => {
    expect(() =>
      validateSignatureImageFile({ size: 100, type: 'image/webp' }),
    ).toThrow('PNG or JPEG')
    expect(() =>
      validateSignatureImageFile({
        size: 3 * 1024 * 1024 + 1,
        type: 'image/png',
      }),
    ).toThrow('3 MB or smaller')
    expect(() =>
      normalizeSignaturePixels({
        data: new Uint8ClampedArray(4),
        height: 4_000,
        width: 4_000,
      }),
    ).toThrow('12 megapixels or fewer')
  })

  it('converts transparent canvas strokes into a cropped PNG image', () => {
    const pixels = buildPixels(40, 24, [0, 0, 0, 0])
    drawStroke(pixels, [17, 24, 39, 255])
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = pixels.width
    sourceCanvas.height = pixels.height
    Object.defineProperty(sourceCanvas, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        getImageData: () => pixels,
      })),
    })

    const outputCanvas = document.createElement('canvas')
    const outputContext = {
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        height,
        width,
      }),
      putImageData: vi.fn(),
    }
    Object.defineProperty(outputCanvas, 'getContext', {
      configurable: true,
      value: vi.fn(() => outputContext),
    })
    Object.defineProperty(outputCanvas, 'toDataURL', {
      configurable: true,
      value: vi.fn(() => 'data:image/png;base64,iVBORw0KGgo='),
    })
    vi.spyOn(document, 'createElement').mockReturnValueOnce(outputCanvas)

    const result = normalizeSignatureCanvas(sourceCanvas)

    expect(result).toMatchObject({
      backgroundRemoved: false,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      mimeType: 'image/png',
    })
    expect(result.width).toBeLessThan(sourceCanvas.width)
    expect(result.height).toBeLessThan(sourceCanvas.height)
    expect(outputContext.putImageData).toHaveBeenCalledOnce()
  })
})
