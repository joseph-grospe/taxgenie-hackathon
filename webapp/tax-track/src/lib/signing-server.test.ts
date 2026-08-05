import { describe, expect, it } from 'vitest'

import {
  fitRectWithinRect,
  getAutoTextBlockRect,
  getAutoTextBlockSize,
  getDefaultSignatureImageRect,
  getScaledAutoTextBlockSize,
  getSignatureCaptionFieldRects,
  getSignatureCaptionRect,
  getSignatureImageRect,
  getSignatureTextFontSize,
} from '@/lib/signing-placement'
import {
  buildPlacementTemplate,
  getTemplateKeyForFile,
} from '@/lib/signing-server'
import { signCertificateRequestSchema } from '@/lib/signing-module'

describe('signing-server helpers', () => {
  it('derives inline caption fields inside the bottom text band', () => {
    const placement = buildPlacementTemplate(1, {
      x: 0.58,
      y: 0.66,
      width: 0.24,
      height: 0.16,
    })
    const captionRect = getSignatureCaptionRect(placement.signatureRect)

    expect(placement.pageNumber).toBe(1)
    expect(placement.signatureRect).toEqual({
      x: 0.58,
      y: 0.66,
      width: 0.24,
      height: 0.16,
    })
    expect(placement.signatureImageRect).toBeUndefined()
    expect(placement.nameRect.x).toBe(captionRect.x)
    expect(placement.nameRect.y).toBe(captionRect.y)
    expect(captionRect.y).toBeGreaterThan(placement.signatureRect.y)
    expect(captionRect.width).toBe(placement.signatureRect.width)
    expect(placement.designationRect.x).toBeGreaterThan(placement.nameRect.x)
    expect(placement.tinRect.x).toBeGreaterThan(placement.designationRect.x)
    expect(placement.tinRect.x + placement.tinRect.width).toBeLessThanOrEqual(
      captionRect.x + captionRect.width,
    )
  })

  it('centers the signature above Designation with a 25% overlap', () => {
    const signatureRect = {
      x: 0.58,
      y: 0.66,
      width: 0.24,
      height: 0.16,
    }

    const imageContainer = getSignatureImageRect(signatureRect)
    const imageRect = getDefaultSignatureImageRect(
      signatureRect,
      320,
      120,
      612,
      792,
    )
    const captionRect = getSignatureCaptionRect(signatureRect)
    const { nameRect, designationRect, tinRect } =
      getSignatureCaptionFieldRects(signatureRect)
    const overlap = imageRect.y + imageRect.height - captionRect.y

    expect(imageContainer.x + imageContainer.width / 2).toBeCloseTo(
      designationRect.x + designationRect.width / 2,
    )
    expect(imageRect.x).toBeGreaterThan(nameRect.x + nameRect.width)
    expect(imageRect.x + imageRect.width).toBeLessThan(tinRect.x)
    expect(overlap / imageRect.height).toBeCloseTo(0.25)
    expect((imageRect.width * 612) / (imageRect.height * 792)).toBeCloseTo(
      320 / 120,
    )
    expect(imageRect.y).toBeGreaterThanOrEqual(signatureRect.y)
    expect(imageRect.y + imageRect.height).toBeLessThanOrEqual(
      signatureRect.y + signatureRect.height,
    )
  })

  it('centers narrow signature images inside the Designation slot', () => {
    const signatureRect = {
      x: 0.58,
      y: 0.66,
      width: 0.24,
      height: 0.16,
    }

    const imageContainer = getSignatureImageRect(signatureRect)
    const imageRect = getDefaultSignatureImageRect(
      signatureRect,
      120,
      320,
      612,
      792,
    )

    expect(imageRect.x + imageRect.width / 2).toBeCloseTo(
      imageContainer.x + imageContainer.width / 2,
    )
    expect(imageRect.width).toBeLessThan(imageContainer.width)
    expect(imageRect.height).toBe(imageContainer.height)
  })

  it('fits resized signature containers using the same contained-image bounds as the preview', () => {
    const fittedRect = fitRectWithinRect(
      {
        x: 0.6,
        y: 0.7,
        width: 0.18,
        height: 0.08,
      },
      220,
      120,
    )

    expect(fittedRect.width).toBeLessThan(0.18)
    expect(fittedRect.height).toBe(0.08)
    expect(fittedRect.x).toBe(0.6)
  })

  it('auto-sizes the text block from the caption value and keeps it on the page', () => {
    const autoSize = getAutoTextBlockSize(
      'Joseph Gropse     /     Accounting Manager     /     112-331-412-000',
    )

    expect(autoSize.width).toBeGreaterThan(0.2)
    expect(autoSize.height).toBeLessThan(0.08)

    const rect = getAutoTextBlockRect(
      {
        x: 0.88,
        y: 0.92,
        width: 0.24,
        height: 0.16,
      },
      'Joseph Gropse     /     Accounting Manager     /     112-331-412-000',
    )

    expect(rect.x + rect.width).toBeLessThanOrEqual(1)
    expect(rect.y + rect.height).toBeLessThanOrEqual(1)
  })

  it('scales auto-sized signature blocks from their center and keeps them on the page', () => {
    const caption = 'Tax Manager     /     Finance Lead     /     112-331-412'
    const autoSize = getScaledAutoTextBlockSize(caption, 1)
    const largerSize = getScaledAutoTextBlockSize(caption, 1.4)

    expect(largerSize.width).toBeCloseTo(autoSize.width * 1.4)
    expect(largerSize.height).toBeCloseTo(autoSize.height * 1.4)

    const placement = {
      x: 0.3,
      y: 0.72,
      width: autoSize.width,
      height: autoSize.height,
    }
    const largerRect = getAutoTextBlockRect(placement, caption, 1.4)

    expect(largerRect.width).toBeCloseTo(largerSize.width)
    expect(largerRect.height).toBeCloseTo(largerSize.height)
    expect(largerRect.x + largerRect.width / 2).toBeCloseTo(
      placement.x + placement.width / 2,
    )
    expect(largerRect.y + largerRect.height / 2).toBeCloseTo(
      placement.y + placement.height / 2,
    )

    const edgeRect = getAutoTextBlockRect(
      {
        x: 0.9,
        y: 0.95,
        width: autoSize.width,
        height: autoSize.height,
      },
      caption,
      1.4,
    )

    expect(edgeRect.x + edgeRect.width).toBeLessThanOrEqual(1)
    expect(edgeRect.y + edgeRect.height).toBeLessThanOrEqual(1)
  })

  it('uses the resized combined block height to derive signer text size', () => {
    const pageHeight = 792
    const blockRect = {
      x: 0.3,
      y: 0.72,
      width: 0.48,
      height: 0.07,
    }
    const largerBlockRect = {
      ...blockRect,
      width: 0.672,
      height: 0.098,
    }

    expect(getSignatureTextFontSize(blockRect, pageHeight)).toBeCloseTo(7)
    expect(getSignatureTextFontSize(largerBlockRect, pageHeight)).toBeCloseTo(
      9.78,
      1,
    )
  })

  it('keeps longer captions on a single-line sized strip by widening instead of growing taller', () => {
    const shortSize = getAutoTextBlockSize('Name / Designation / TIN')
    const longSize = getAutoTextBlockSize(
      'Joseph Gropse     /     Senior Accounting Manager     /     112-331-412-000',
    )

    expect(longSize.width).toBeGreaterThan(shortSize.width)
    expect(longSize.height).toBe(shortSize.height)
  })

  it('falls back to the default template key when certificate metadata is missing', () => {
    expect(
      getTemplateKeyForFile({
        certificateDocumentType: null,
        certificateIssuerShortNameNormalized: null,
      } as never),
    ).toBe('default-bir-2307')

    expect(
      getTemplateKeyForFile({
        certificateDocumentType: 'bir-2307',
        certificateIssuerShortNameNormalized: 'akelco',
      } as never),
    ).toBe('bir-2307:akelco')
  })
})

describe('signCertificateRequestSchema', () => {
  it('accepts one or more normalized signature rectangles inside the page bounds', () => {
    const parsed = signCertificateRequestSchema.safeParse({
      targets: [
        {
          certificateId: '34',
          pageNumber: 1,
          signatureRect: {
            x: 0.5,
            y: 0.5,
            width: 0.2,
            height: 0.15,
          },
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  it('accepts legacy signature image rectangles for request compatibility', () => {
    const parsed = signCertificateRequestSchema.safeParse({
      targets: [
        {
          certificateId: '34',
          pageNumber: 1,
          signatureRect: {
            x: 0.5,
            y: 0.5,
            width: 0.2,
            height: 0.15,
          },
          signatureImageRect: {
            x: 0.7,
            y: 0.53,
            width: 0.08,
            height: 0.09,
          },
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  it('accepts an explicit re-sign request flag', () => {
    const parsed = signCertificateRequestSchema.safeParse({
      resign: true,
      targets: [
        {
          certificateId: '34',
          pageNumber: 1,
          signatureRect: {
            x: 0.5,
            y: 0.5,
            width: 0.2,
            height: 0.15,
          },
        },
      ],
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      throw new Error('Expected re-sign request to parse.')
    }
    expect(parsed.data.resign).toBe(true)
  })

  it('accepts a client-side signing interaction start timestamp', () => {
    const parsed = signCertificateRequestSchema.safeParse({
      signingStartedAt: '2026-05-08T10:15:00.000Z',
      targets: [
        {
          certificateId: '34',
          pageNumber: 1,
          signatureRect: {
            x: 0.5,
            y: 0.5,
            width: 0.2,
            height: 0.15,
          },
        },
      ],
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) {
      throw new Error('Expected signing timestamp request to parse.')
    }
    expect(parsed.data.signingStartedAt).toBe('2026-05-08T10:15:00.000Z')
  })

  it('rejects rectangles that overflow the page bounds', () => {
    const parsed = signCertificateRequestSchema.safeParse({
      targets: [
        {
          certificateId: '34',
          pageNumber: 1,
          signatureRect: {
            x: 0.9,
            y: 0.1,
            width: 0.2,
            height: 0.1,
          },
        },
      ],
    })

    expect(parsed.success).toBe(false)
  })
})
