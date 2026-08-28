import { describe, expect, it } from 'vitest'

import {
  buildCustomerStorageKey,
  buildEntityStorageKey,
  buildRawUploadKey,
  buildStorageKey,
  sanitizeStorageRevision,
} from '@taxgenie/shared'

describe('storage key helpers', () => {
  it('uses short name plus id for entity keys', () => {
    expect(buildEntityStorageKey({ id: 42, shortName: 'TMI' })).toBe('tmi-42')
  })

  it('falls back to entity id when short name is missing', () => {
    expect(buildEntityStorageKey({ id: 42, shortName: null })).toBe('entity-42')
  })

  it('normalizes unsafe entity short name characters', () => {
    expect(buildEntityStorageKey({ id: 7, shortName: ' ACME / Luzon! ' })).toBe(
      'acme-luzon-7',
    )
  })

  it('uses customer short name for customer keys', () => {
    expect(buildCustomerStorageKey({ shortName: ' Customer A ' })).toBe(
      'customer-a',
    )
  })

  it('falls back when customer short name is missing', () => {
    expect(buildCustomerStorageKey({ shortName: null })).toBe(
      'customer-unknown',
    )
  })

  it('trims prefix slashes without creating double slashes', () => {
    expect(buildStorageKey('/v2/', '/entities/', 'tmi-42')).toBe(
      'v2/entities/tmi-42',
    )
  })

  it('sanitizes revision tokens for path usage', () => {
    expect(sanitizeStorageRevision('"etag/value:123"')).toBe('etag-value-123')
  })

  it('builds raw upload keys with the fixed source.pdf object name', () => {
    expect(
      buildRawUploadKey({
        prefix: 'v2',
        entityKey: 'tmi-42',
        uploadedAt: new Date('2026-05-08T10:15:00.000Z'),
        batchId: 'batch-1',
        uploadId: 'upload-1',
      }),
    ).toBe('v2/entities/tmi-42/intake/2026/05/08/batch-1/upload-1/source.pdf')
  })
})
