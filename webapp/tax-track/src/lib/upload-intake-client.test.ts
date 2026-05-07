import { describe, expect, it } from 'vitest'

import type { LocalUploadItem } from '@/lib/upload-intake-types'
import {
  canRemoveLocalSelectedFile,
  getPendingLocalUploadCount,
  removeLocalSelectedFile,
} from '@/lib/upload-intake-client'

const buildLocalUpload = (
  overrides: Partial<LocalUploadItem> = {},
): LocalUploadItem => ({
  clientId: 'client-1',
  file: {
    name: 'wrong.pdf',
    size: 2048,
    type: 'application/pdf',
  } as File,
  progress: 0,
  status: 'Pending',
  error: null,
  uploadId: null,
  batchId: null,
  ...overrides,
})

describe('upload-intake-client local removal helpers', () => {
  it('removes one selected PDF and keeps the remaining file ready to upload', () => {
    const remaining = removeLocalSelectedFile(
      [
        buildLocalUpload({
          clientId: 'wrong-file',
          file: { name: 'wrong.pdf', size: 2048 } as File,
        }),
        buildLocalUpload({
          clientId: 'right-file',
          file: { name: 'right.pdf', size: 2048 } as File,
        }),
      ],
      'wrong-file',
    )

    expect(remaining.map((item) => item.file.name)).toEqual(['right.pdf'])
    expect(getPendingLocalUploadCount(remaining)).toBe(1)
  })

  it('returns an empty selected list when the last selected PDF is removed', () => {
    const remaining = removeLocalSelectedFile(
      [
        buildLocalUpload({
          clientId: 'only-file',
          file: { name: 'only.pdf', size: 2048 } as File,
        }),
      ],
      'only-file',
    )

    expect(remaining).toEqual([])
    expect(getPendingLocalUploadCount(remaining)).toBe(0)
  })

  it('does not remove server-backed or active upload rows', () => {
    const serverBacked = buildLocalUpload({
      clientId: 'server-backed',
      uploadId: 'upload-1',
      status: 'Error',
    })
    const uploading = buildLocalUpload({
      clientId: 'uploading',
      status: 'Uploading',
    })

    expect(canRemoveLocalSelectedFile(serverBacked)).toBe(false)
    expect(canRemoveLocalSelectedFile(uploading)).toBe(false)
    expect(removeLocalSelectedFile([serverBacked], 'server-backed')).toEqual([
      serverBacked,
    ])
    expect(removeLocalSelectedFile([uploading], 'uploading')).toEqual([
      uploading,
    ])
  })
})
