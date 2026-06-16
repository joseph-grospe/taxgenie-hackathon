import { describe, expect, it } from 'vitest'

import {
  fitRectWithinRect,
  getAutoTextBlockRect,
  getAutoTextBlockSize,
  getSignatureCaptionRect,
  getSignatureImageRect,
} from '@/lib/signing-placement'
import {
  buildPlacementTemplate,
  getTemplateKeyForFile,
} from '@/lib/signing-server'
import { signCertificateRequestSchema } from '@/lib/signing-module'

describe('signing-server helpers', () => {
  it('derives inline caption bounds inside the left side of the placed block', () => {
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
    expect(placement.designationRect.x).toBeGreaterThan(placement.nameRect.x)
    expect(placement.tinRect.x).toBeGreaterThan(placement.designationRect.x)
    expect(placement.tinRect.x + placement.tinRect.width).toBeLessThanOrEqual(
      captionRect.x + captionRect.width,
    )
  })

  it('places the signature image in the right side of the combined block', () => {
    const signatureRect = {
      x: 0.58,
      y: 0.66,
      width: 0.24,
      height: 0.16,
    }

    const imageRect = getSignatureImageRect(signatureRect)
    const captionRect = getSignatureCaptionRect(signatureRect)

    expect(imageRect.x).toBeGreaterThan(captionRect.x + captionRect.width)
    expect(imageRect.y).toBeGreaterThan(signatureRect.y)
    expect(imageRect.width).toBeLessThan(signatureRect.width)
    expect(imageRect.y + imageRect.height).toBeLessThan(
      signatureRect.y + signatureRect.height,
    )
  })

  it('fits narrower signature images inside the right-side signature slot', () => {
    const signatureRect = {
      x: 0.58,
      y: 0.66,
      width: 0.24,
      height: 0.16,
    }

    const imageRect = fitRectWithinRect(
      getSignatureImageRect(signatureRect),
      180,
      220,
    )

    expect(imageRect.x).toBeGreaterThan(
      signatureRect.x + signatureRect.width / 2,
    )
    expect(imageRect.width).toBeLessThan(signatureRect.width)
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
          documentResultId: '34',
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
          documentResultId: '34',
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
          documentResultId: '34',
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
          documentResultId: '34',
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
          documentResultId: '34',
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
