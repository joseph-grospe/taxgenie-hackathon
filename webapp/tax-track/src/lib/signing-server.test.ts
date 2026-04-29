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
  it('derives caption bounds beneath the placed signature block', () => {
    const placement = buildPlacementTemplate(1, {
      x: 0.58,
      y: 0.66,
      width: 0.24,
      height: 0.16,
    })

    expect(placement.pageNumber).toBe(1)
    expect(placement.signatureRect).toEqual({
      x: 0.58,
      y: 0.66,
      width: 0.24,
      height: 0.16,
    })
    expect(placement.nameRect.y).toBeGreaterThan(placement.signatureRect.y)
    expect(placement.designationRect.y).toBeGreaterThan(placement.nameRect.y)
    expect(placement.tinRect.y).toBeGreaterThan(placement.designationRect.y)
    expect(placement.nameRect.width).toBe(placement.signatureRect.width)
  })

  it('preserves a custom signature image rectangle when provided', () => {
    const placement = buildPlacementTemplate(
      1,
      {
        x: 0.58,
        y: 0.66,
        width: 0.24,
        height: 0.16,
      },
      {
        x: 0.6,
        y: 0.7,
        width: 0.18,
        height: 0.08,
      },
    )

    expect(placement.signatureImageRect).toEqual({
      x: 0.6,
      y: 0.7,
      width: 0.18,
      height: 0.08,
    })
  })

  it('places the signature image above and slightly overlapping the caption line', () => {
    const signatureRect = {
      x: 0.58,
      y: 0.66,
      width: 0.24,
      height: 0.16,
    }

    const imageRect = getSignatureImageRect(signatureRect)
    const captionRect = getSignatureCaptionRect(signatureRect)

    expect(imageRect.y).toBe(signatureRect.y)
    expect(imageRect.width).toBeLessThan(signatureRect.width)
    expect(imageRect.y + imageRect.height).toBeGreaterThanOrEqual(captionRect.y)
    expect(imageRect.y + imageRect.height).toBeLessThan(
      captionRect.y + captionRect.height,
    )
  })

  it('left-aligns narrower signature images with the name section', () => {
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

    expect(imageRect.x).toBe(signatureRect.x)
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
    expect(parsed.data?.resign).toBe(true)
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
