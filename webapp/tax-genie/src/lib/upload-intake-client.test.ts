import { describe, expect, it, vi } from 'vitest'

import type { LocalUploadItem } from '@/lib/upload-intake-types'
import {
  buildLocalSelectionSummary,
  canRemoveLocalSelectedFile,
  chunkUploadItems,
  filterEncryptedPdfUploadFiles,
  filterIntakeUploadFilesBySize,
  getIntakeUploadFileSizeRejectionMessage,
  getIntakeUploadFileSizeRejectionReason,
  getPendingLocalUploadCount,
  isWithinIntakeUploadFileSizeLimit,
  removeLocalSelectedFile,
  runWithConcurrencyLimit,
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

const buildPdfFile = (name: string) =>
  new File([new Uint8Array([37, 80, 68, 70])], name, {
    type: 'application/pdf',
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

describe('upload-intake-client large batch helpers', () => {
  it('summarizes selected files without rendering every row', () => {
    const summary = buildLocalSelectionSummary([
      buildLocalUpload({
        clientId: 'a',
        file: { name: 'same.pdf', size: 100 } as File,
      }),
      buildLocalUpload({
        clientId: 'b',
        file: { name: 'same.pdf', size: 200 } as File,
        status: 'Error',
      }),
      buildLocalUpload({
        clientId: 'c',
        file: { name: 'other.pdf', size: 300 } as File,
        status: 'Uploading',
      }),
    ])

    expect(summary).toEqual({
      selectedCount: 3,
      totalSizeBytes: 600,
      readyCount: 2,
      errorCount: 1,
      duplicateNameCount: 1,
    })
  })

  it('chunks presign requests at the configured maximum', () => {
    const items = Array.from({ length: 101 }, (_item, index) => index)

    expect(chunkUploadItems(items, 50).map((chunk) => chunk.length)).toEqual([
      50, 50, 1,
    ])
  })

  it('limits concurrent upload workers', async () => {
    let active = 0
    let peak = 0

    await runWithConcurrencyLimit(
      Array.from({ length: 12 }, (_item, index) => index),
      async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active -= 1
      },
      4,
    )

    expect(peak).toBeLessThanOrEqual(4)
  })
})

describe('upload-intake-client file size helpers', () => {
  it('accepts selected BIR PDFs at or under the 20 MiB limit', () => {
    expect(
      isWithinIntakeUploadFileSizeLimit({
        name: 'non-empty.pdf',
        size: 1,
      }),
    ).toBe(true)
    expect(
      isWithinIntakeUploadFileSizeLimit({
        name: 'at-limit.pdf',
        size: MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
      }),
    ).toBe(true)
  })

  it('rejects selected empty BIR PDFs', () => {
    const files = [
      {
        name: 'empty-a.pdf',
        size: 0,
      },
      {
        name: 'empty-b.pdf',
        size: 0,
      },
    ]

    expect(isWithinIntakeUploadFileSizeLimit(files[0])).toBe(false)
    expect(getIntakeUploadFileSizeRejectionReason(files[0])).toBe('empty')
    expect(getIntakeUploadFileSizeRejectionMessage('empty')).toBe(
      'File is empty.',
    )
    expect(filterIntakeUploadFilesBySize(files)).toEqual({
      acceptedFiles: [],
      rejectedFiles: files,
      errorMessage:
        '2 files were skipped because they are empty: empty-a.pdf, empty-b.pdf.',
    })
  })

  it('rejects selected BIR PDFs over the 20 MiB limit', () => {
    const file = {
      name: 'too-large.pdf',
      size: MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES + 1,
    }

    expect(isWithinIntakeUploadFileSizeLimit(file)).toBe(false)
    expect(getIntakeUploadFileSizeRejectionReason(file)).toBe('too_large')
    expect(getIntakeUploadFileSizeRejectionMessage('too_large')).toBe(
      'File exceeds 20 MiB.',
    )
    expect(filterIntakeUploadFilesBySize([file])).toEqual({
      acceptedFiles: [],
      rejectedFiles: [file],
      errorMessage:
        '1 file was skipped. Each BIR 2307 PDF must be 20 MiB or smaller. Skipped: too-large.pdf (20.0 MiB).',
    })
  })

  it('keeps valid files from mixed selections and reports oversized files', () => {
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
        '1 file was skipped. Each BIR 2307 PDF must be 20 MiB or smaller. Skipped: too-large.pdf (20.0 MiB).',
    })
  })

  it('keeps valid files from mixed selections and reports empty files', () => {
    const accepted = {
      name: 'valid.pdf',
      size: 1,
    }
    const rejected = {
      name: 'empty.pdf',
      size: 0,
    }

    expect(filterIntakeUploadFilesBySize([accepted, rejected])).toEqual({
      acceptedFiles: [accepted],
      rejectedFiles: [rejected],
      errorMessage: '1 file was skipped because it is empty: empty.pdf.',
    })
  })
})

describe('upload-intake-client encrypted PDF helpers', () => {
  it('accepts PDFs that load without encryption errors', async () => {
    const file = buildPdfFile('loadable.pdf')
    const loadPdf = vi.fn().mockResolvedValue(undefined)

    const result = await filterEncryptedPdfUploadFiles([file], { loadPdf })

    expect(result.acceptedFiles).toEqual([file])
    expect(result.rejectedFiles).toEqual([])
    expect(result.errorMessage).toBeNull()
    expect(loadPdf).toHaveBeenCalledWith(expect.any(ArrayBuffer))
  })

  it('rejects encrypted PDFs during selection preflight', async () => {
    const encrypted = buildPdfFile('encrypted.pdf')
    const loadable = buildPdfFile('loadable.pdf')
    const loadPdf = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Input document to `PDFDocument.load` is encrypted. You can use `PDFDocument.load(..., { ignoreEncryption: true })` if you wish to load the document anyways.',
        ),
      )
      .mockResolvedValueOnce(undefined)

    const result = await filterEncryptedPdfUploadFiles([encrypted, loadable], {
      loadPdf,
      concurrencyLimit: 1,
    })

    expect(result.acceptedFiles).toEqual([loadable])
    expect(result.rejectedFiles).toEqual([encrypted])
    expect(result.errorMessage).toBe(
      '1 file was skipped because it is encrypted: encrypted.pdf. Remove encryption and select again.',
    )
  })

  it('keeps non-encrypted parse failures for worker handling', async () => {
    const file = buildPdfFile('parse-error.pdf')
    const loadPdf = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to parse PDF document.'))

    const result = await filterEncryptedPdfUploadFiles([file], { loadPdf })

    expect(result.acceptedFiles).toEqual([file])
    expect(result.rejectedFiles).toEqual([])
    expect(result.errorMessage).toBeNull()
  })
})
