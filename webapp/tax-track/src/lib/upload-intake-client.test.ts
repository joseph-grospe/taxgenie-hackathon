import { describe, expect, it } from 'vitest'

import type { LocalUploadItem } from '@/lib/upload-intake-types'
import {
  canRemoveLocalSelectedFile,
  filterIntakeUploadFilesBySize,
  getPendingLocalUploadCount,
  isWithinIntakeUploadFileSizeLimit,
  removeLocalSelectedFile,
} from '@/lib/upload-intake-client'
import { MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES } from '@/lib/intake-utils'

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

describe('upload-intake-client file size helpers', () => {
  it('accepts selected BIR PDFs at or under the 4 MiB limit', () => {
    expect(
      isWithinIntakeUploadFileSizeLimit({
        name: 'at-limit.pdf',
        size: MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
      }),
    ).toBe(true)
  })

  it('rejects selected BIR PDFs over the 4 MiB limit', () => {
    const file = {
      name: 'too-large.pdf',
      size: MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES + 1,
    }

    expect(isWithinIntakeUploadFileSizeLimit(file)).toBe(false)
    expect(filterIntakeUploadFilesBySize([file])).toEqual({
      acceptedFiles: [],
      rejectedFiles: [file],
      errorMessage:
        '1 file was skipped. Each BIR 2307 PDF must be 4 MiB or smaller. Skipped: too-large.pdf (4.0 MiB).',
    })
  })

  it('keeps valid files from mixed selections and reports rejected files', () => {
    const accepted = {
      name: 'valid.pdf',
      size: MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
    }
    const rejected = {
      name: 'too-large.pdf',
      size: MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES + 1,
    }

    expect(filterIntakeUploadFilesBySize([accepted, rejected])).toEqual({
      acceptedFiles: [accepted],
      rejectedFiles: [rejected],
      errorMessage:
        '1 file was skipped. Each BIR 2307 PDF must be 4 MiB or smaller. Skipped: too-large.pdf (4.0 MiB).',
    })
  })
})
