import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ChangeEvent } from 'react'

import type {
  IntakeBatchView,
  IntakeUploadView,
  LocalUploadItem,
  PresignResponse,
  PresignedUpload,
  RecentBatchesResponse,
  SkippedUploadFile,
  UploadEntitiesResponse,
  UploadEntityOption,
} from '@/lib/upload-intake-types'
import {
  buildIntakeUploadSizeLimitMessage,
  chunkUploadItems,
  filterIntakeUploadFilesBySize,
  getIntakeUploadFileSizeRejectionMessage,
  getIntakeUploadFileSizeRejectionReason,
  isWithinIntakeUploadFileSizeLimit,
  removeLocalSelectedFile,
  runWithConcurrencyLimit,
  toServerStatus,
  xhrPut,
} from '@/lib/upload-intake-client'
import { defaultBatchDetailSearch } from '@/lib/batch-file-search-state'
import { AppShell } from '@/components/app-shell'
import { useEntityScope } from '@/components/entity-scope-provider'
import { UploadIntakePage } from '@/components/upload-intake-page'

const POLL_INTERVAL_MS = 8_000

const getActiveBatchUploads = (activeBatch: IntakeBatchView | null) =>
  activeBatch?.files ?? []

const getKnownUploads = (
  activeBatch: IntakeBatchView | null,
  recentBatches: Array<IntakeBatchView>,
) => [
  ...getActiveBatchUploads(activeBatch),
  ...recentBatches.flatMap((batch) => batch.files),
]

const getSkippedFileName = (file: File) => file.name || 'Unnamed file'

const buildSkippedCountLabel = (count: number) =>
  count === 1 ? '1 file was skipped' : `${count} files were skipped`

const formatSkippedFileNames = (files: Array<File>) => {
  const visibleNames = files.slice(0, 3).map(getSkippedFileName)
  const extraCount = files.length - visibleNames.length

  return extraCount > 0
    ? `${visibleNames.join(', ')}, and ${extraCount} more`
    : visibleNames.join(', ')
}

const buildUnsupportedFileMessage = (files: Array<File>) => {
  if (files.length === 0) {
    return null
  }

  const unsupportedFilePronoun = files.length === 1 ? 'it is' : 'they are'

  return `${buildSkippedCountLabel(files.length)} because ${unsupportedFilePronoun} not a PDF: ${formatSkippedFileNames(files)}.`
}

const buildSelectionWarningMessage = (
  messages: Array<string | null | undefined>,
) => {
  const message = messages.filter((item): item is string => Boolean(item))
  return message.length > 0 ? message.join(' ') : null
}

const buildSkippedUploadFile = (
  file: File,
  reason: SkippedUploadFile['reason'],
): SkippedUploadFile => {
  const message =
    reason === 'not_pdf'
      ? 'Only PDF files are supported.'
      : getIntakeUploadFileSizeRejectionMessage(reason)

  return {
    id: globalThis.crypto.randomUUID(),
    fileName: getSkippedFileName(file),
    sizeBytes: file.size,
    reason,
    message,
  }
}

const buildSizeSkippedUploadFiles = (files: Array<File>) =>
  files.flatMap((file) => {
    const reason = getIntakeUploadFileSizeRejectionReason(file)
    return reason ? [buildSkippedUploadFile(file, reason)] : []
  })

const isPdfUploadCandidate = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

export const Route = createFileRoute('/upload')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const { selectedEntityId: globalEntityId } = useEntityScope()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isBatchRoute =
    pathname !== '/upload' && pathname.startsWith('/upload/batches/')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const startUploadInFlightRef = useRef(false)
  const entitySelectionTouchedRef = useRef(false)
  const [localFiles, setLocalFiles] = useState<Array<LocalUploadItem>>([])
  const [activeBatch, setActiveBatch] = useState<IntakeBatchView | null>(null)
  const [recentBatches, setRecentBatches] = useState<Array<IntakeBatchView>>([])
  const [uploadEntities, setUploadEntities] = useState<
    Array<UploadEntityOption>
  >([])
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoadingEntities, setIsLoadingEntities] = useState(false)
  const [isStartingUpload, setIsStartingUpload] = useState(false)
  const [isClosingBatch, setIsClosingBatch] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null)
  const [selectionSkippedFiles, setSelectionSkippedFiles] = useState<
    Array<SkippedUploadFile>
  >([])
  const selectionSkippedCount = selectionSkippedFiles.length

  const loadUploadEntities = useCallback(async () => {
    setIsLoadingEntities(true)

    try {
      const response = await fetch('/api/uploads/entities', {
        cache: 'no-store',
      })

      const payload = (await response.json().catch(() => null)) as
        | (Partial<UploadEntitiesResponse> & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load entities (${response.status}).`,
        )
      }

      setUploadEntities(
        Array.isArray(payload?.entities) ? payload.entities : [],
      )
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load entities.',
      )
    } finally {
      setIsLoadingEntities(false)
    }
  }, [])

  const refreshUploads = useCallback(async () => {
    setIsRefreshing(true)

    try {
      const response = await fetch('/api/uploads/recent', {
        cache: 'no-store',
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          payload?.error || `Failed to load uploads (${response.status}).`,
        )
      }

      const payload = (await response.json()) as Partial<RecentBatchesResponse>
      const nextActiveBatch = payload.activeBatch ?? null
      const nextRecentBatches = Array.isArray(payload.recentBatches)
        ? payload.recentBatches
        : []
      const knownUploadsById = new Map(
        getKnownUploads(nextActiveBatch, nextRecentBatches).map((upload) => [
          upload.id,
          upload,
        ]),
      )

      setActiveBatch(nextActiveBatch)
      setRecentBatches(nextRecentBatches)
      setLocalFiles((current) =>
        current.filter((item) => {
          if (!item.uploadId) {
            return true
          }

          if (knownUploadsById.has(item.uploadId)) {
            return false
          }

          return !['Queued', 'Processing', 'Done', 'Duplicate'].includes(
            item.status,
          )
        }),
      )
      setLoadError(null)
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load uploads.',
      )
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadUploadEntities()
    void refreshUploads()
    const interval = window.setInterval(() => {
      void refreshUploads()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [loadUploadEntities, refreshUploads])

  useEffect(() => {
    if (
      selectedEntityId !== null &&
      !uploadEntities.some((entity) => entity.id === selectedEntityId)
    ) {
      setSelectedEntityId(null)
    }
  }, [selectedEntityId, uploadEntities])

  useEffect(() => {
    if (
      entitySelectionTouchedRef.current ||
      activeBatch?.entity ||
      selectedEntityId !== null
    ) {
      return
    }

    if (!globalEntityId) {
      return
    }

    const uploadEntityId = Number.parseInt(globalEntityId, 10)
    if (uploadEntities.some((entity) => entity.id === uploadEntityId)) {
      setSelectedEntityId(uploadEntityId)
    }
  }, [activeBatch?.entity, globalEntityId, selectedEntityId, uploadEntities])

  const handleEntityChange = useCallback((entityId: number | null) => {
    entitySelectionTouchedRef.current = true
    setSelectedEntityId(entityId)
  }, [])

  const openDestination = useCallback(
    (documentId: string | null | undefined) => {
      if (!documentId) {
        return
      }

      void navigate({
        to: '/documents/$docId',
        params: { docId: documentId },
      })
    },
    [navigate],
  )

  const openBatch = useCallback(
    (batchId: string | null | undefined) => {
      if (!batchId) {
        return
      }

      void navigate({
        to: '/upload/batches/$batchId',
        params: { batchId },
        search: defaultBatchDetailSearch,
      })
    },
    [navigate],
  )

  const updateLocalFile = useCallback(
    (clientId: string, patch: Partial<LocalUploadItem>) => {
      setLocalFiles((current) =>
        current.map((item) =>
          item.clientId === clientId ? { ...item, ...patch } : item,
        ),
      )
    },
    [],
  )

  const removeLocalFile = useCallback((clientId: string) => {
    setSelectionWarning(null)
    setSelectionSkippedFiles([])
    setLocalFiles((current) => removeLocalSelectedFile(current, clientId))
  }, [])

  const uploadSelectedFile = useCallback(
    async (
      item: LocalUploadItem,
      presigned: PresignedUpload,
      options: { refreshOnComplete?: boolean } = {},
    ) => {
      updateLocalFile(item.clientId, {
        batchId: presigned.batchId,
        uploadId: presigned.uploadId,
        status: 'Uploading',
        progress: 0,
        error: null,
      })

      try {
        const uploadStartedAt = new Date().toISOString()
        await xhrPut(
          presigned.url,
          item.file,
          presigned.headers,
          (progress) => {
            updateLocalFile(item.clientId, { progress, status: 'Uploading' })
          },
        )
        const uploadFinishedAt = new Date().toISOString()

        updateLocalFile(item.clientId, {
          progress: 100,
          status: 'Queueing',
        })

        const completeResponse = await fetch('/api/uploads/complete', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            uploadId: presigned.uploadId,
            uploadStartedAt,
            uploadFinishedAt,
          }),
        })

        const payload = (await completeResponse.json().catch(() => null)) as {
          error?: string
          upload?: IntakeUploadView
        } | null

        if (!completeResponse.ok) {
          throw new Error(payload?.error || 'Unable to queue uploaded file.')
        }

        updateLocalFile(item.clientId, {
          status: toServerStatus(payload?.upload?.overallStatus ?? 'queued'),
          error: payload?.upload?.errorMessage ?? null,
        })

        if (options.refreshOnComplete !== false) {
          await refreshUploads()
        }
      } catch (error) {
        updateLocalFile(item.clientId, {
          status: 'Error',
          error: error instanceof Error ? error.message : 'Upload failed.',
        })

        if (options.refreshOnComplete !== false) {
          await refreshUploads()
        }
      }
    },
    [refreshUploads, updateLocalFile],
  )

  const startUpload = useCallback(async () => {
    if (startUploadInFlightRef.current) {
      return
    }

    const pendingItems = localFiles.filter((item) =>
      ['Pending', 'Error'].includes(item.status),
    )
    if (pendingItems.length === 0) {
      return
    }

    const validPendingItems = pendingItems.filter((item) =>
      isWithinIntakeUploadFileSizeLimit(item.file),
    )
    const invalidPendingItems = pendingItems.filter(
      (item) => !isWithinIntakeUploadFileSizeLimit(item.file),
    )

    if (invalidPendingItems.length > 0) {
      const invalidFileMessage =
        buildIntakeUploadSizeLimitMessage(
          invalidPendingItems.map((item) => item.file),
        ) ?? 'Some selected files could not be uploaded.'
      const invalidSkippedFiles = buildSizeSkippedUploadFiles(
        invalidPendingItems.map((item) => item.file),
      )

      setLocalFiles((current) =>
        current.map((item) =>
          invalidPendingItems.some(
            (invalid) => invalid.clientId === item.clientId,
          )
            ? {
                ...item,
                status: 'Error',
                error: invalidFileMessage,
              }
            : item,
        ),
      )
      setSelectionWarning(invalidFileMessage)
      setSelectionSkippedFiles(invalidSkippedFiles)

      if (validPendingItems.length === 0) {
        return
      }
    }

    if (!activeBatch?.entity && selectedEntityId === null) {
      setLoadError('Choose an entity before uploading documents.')
      return
    }

    if (activeBatch && !activeBatch.entity && activeBatch.totalFiles > 0) {
      setLoadError(
        'Close this legacy upload batch before starting entity-based uploads.',
      )
      return
    }

    startUploadInFlightRef.current = true
    setIsStartingUpload(true)
    if (invalidPendingItems.length === 0) {
      setSelectionWarning(null)
      setSelectionSkippedFiles([])
    }
    setLocalFiles((current) =>
      current.map((item) =>
        validPendingItems.some((pending) => pending.clientId === item.clientId)
          ? { ...item, status: 'Requesting', error: null }
          : item,
      ),
    )

    let currentBatch = activeBatch

    try {
      const chunks = chunkUploadItems(validPendingItems)

      for (const chunk of chunks) {
        const response = await fetch('/api/uploads/presign', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            batchId:
              currentBatch?.status === 'open' ? currentBatch.id : undefined,
            entityId: currentBatch?.entity ? undefined : selectedEntityId,
            files: chunk.map((item) => ({
              name: item.file.name,
              type: item.file.type || 'application/pdf',
              size: item.file.size,
            })),
          }),
        })

        const payload = (await response.json().catch(() => null)) as
          | (PresignResponse & { error?: string })
          | null

        if (!response.ok || !payload) {
          throw new Error(payload?.error || 'Unable to prepare upload batch.')
        }

        if (payload.uploads.length !== chunk.length) {
          throw new Error(
            'Upload preparation returned an unexpected number of files.',
          )
        }

        const presignedByClientId = new Map(
          chunk.map((item, index) => [item.clientId, payload.uploads[index]]),
        )

        setLocalFiles((current) =>
          current.map((item) => {
            const presignedUpload = presignedByClientId.get(item.clientId)

            if (!presignedUpload) {
              return item
            }

            return {
              ...item,
              batchId: presignedUpload.batchId,
              uploadId: presignedUpload.uploadId,
            }
          }),
        )
        currentBatch = payload.batch
        setActiveBatch(payload.batch)

        await runWithConcurrencyLimit(chunk, async (item, index) => {
          const presignedUpload = payload.uploads[index]

          await uploadSelectedFile(item, presignedUpload, {
            refreshOnComplete: false,
          })
        })
        await refreshUploads()
      }
    } catch (error) {
      setLocalFiles((current) =>
        current.map((item) =>
          validPendingItems.some(
            (pending) => pending.clientId === item.clientId,
          ) &&
          ['Pending', 'Requesting', 'Uploading', 'Queueing', 'Error'].includes(
            item.status,
          )
            ? {
                ...item,
                status: 'Error',
                error:
                  error instanceof Error
                    ? error.message
                    : 'Unable to start upload.',
              }
            : item,
        ),
      )
    } finally {
      startUploadInFlightRef.current = false
      setIsStartingUpload(false)
    }
  }, [
    activeBatch,
    localFiles,
    refreshUploads,
    selectedEntityId,
    uploadSelectedFile,
  ])

  const closeBatch = useCallback(async () => {
    if (!activeBatch) {
      return
    }

    setIsClosingBatch(true)

    try {
      const response = await fetch('/api/uploads/batches/active/close', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to close upload batch.')
      }

      await refreshUploads()
      toast.success('Upload batch closed.')
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to close upload batch.',
      )
    } finally {
      setIsClosingBatch(false)
    }
  }, [activeBatch, refreshUploads])

  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectionWarning(null)
    setSelectionSkippedFiles([])

    if (!activeBatch?.entity && selectedEntityId === null) {
      setLoadError('Choose an entity before selecting PDF files.')
      event.target.value = ''
      return
    }

    if (activeBatch && !activeBatch.entity && activeBatch.totalFiles > 0) {
      setLoadError(
        'Close this legacy upload batch before starting entity-based uploads.',
      )
      event.target.value = ''
      return
    }

    const selectedFiles = Array.from(event.target.files ?? [])
    const selectedPdfFiles = selectedFiles.filter(isPdfUploadCandidate)
    const unsupportedFiles = selectedFiles.filter(
      (file) => !isPdfUploadCandidate(file),
    )
    const unsupportedSkippedFiles = unsupportedFiles.map((file) =>
      buildSkippedUploadFile(file, 'not_pdf'),
    )

    if (selectedPdfFiles.length === 0) {
      setSelectionWarning(buildUnsupportedFileMessage(unsupportedFiles))
      setSelectionSkippedFiles(unsupportedSkippedFiles)
      event.target.value = ''
      return
    }

    const { acceptedFiles, rejectedFiles, errorMessage } =
      filterIntakeUploadFilesBySize(selectedPdfFiles)
    const sizeSkippedFiles = buildSizeSkippedUploadFiles(rejectedFiles)
    const skippedFiles = [...unsupportedSkippedFiles, ...sizeSkippedFiles]
    const warningMessage = buildSelectionWarningMessage([
      buildUnsupportedFileMessage(unsupportedFiles),
      errorMessage,
    ])

    if (acceptedFiles.length === 0) {
      setLoadError(null)
      setSelectionWarning(warningMessage)
      setSelectionSkippedFiles(skippedFiles)
      event.target.value = ''
      return
    }

    setLocalFiles((current) => [
      ...current,
      ...acceptedFiles.map((file) => ({
        clientId: globalThis.crypto.randomUUID(),
        file,
        progress: 0,
        status: 'Pending' as const,
        error: null,
        uploadId: null,
        batchId: activeBatch?.id ?? null,
      })),
    ])
    setLoadError(null)
    setSelectionWarning(warningMessage)
    setSelectionSkippedFiles(skippedFiles)
    event.target.value = ''
  }

  const selectFiles = () => {
    if (!activeBatch?.entity && selectedEntityId === null) {
      setLoadError('Choose an entity before selecting PDF files.')
      return
    }

    if (activeBatch && !activeBatch.entity && activeBatch.totalFiles > 0) {
      setLoadError(
        'Close this legacy upload batch before starting entity-based uploads.',
      )
      return
    }

    inputRef.current?.click()
  }

  const uploads = getActiveBatchUploads(activeBatch)

  if (isBatchRoute) {
    return <Outlet />
  }

  return (
    <AppShell
      title="Upload Intake"
      subtitle="Manage one open upload batch at a time, add multiple PDFs into that batch, and track every file from direct upload through processing."
    >
      <UploadIntakePage
        inputRef={inputRef}
        activeBatch={activeBatch}
        recentBatches={recentBatches}
        uploads={uploads}
        uploadEntities={uploadEntities}
        selectedEntityId={selectedEntityId}
        localFiles={localFiles}
        isRefreshing={isRefreshing}
        isLoadingEntities={isLoadingEntities}
        isStartingUpload={isStartingUpload}
        isClosingBatch={isClosingBatch}
        loadError={loadError}
        selectionWarning={selectionWarning}
        selectionSkippedFiles={selectionSkippedFiles}
        selectionSkippedCount={selectionSkippedCount}
        onFilesSelected={handleFilesSelected}
        onEntityChange={handleEntityChange}
        onSelectFiles={selectFiles}
        onStartUpload={() => void startUpload()}
        onCloseBatch={() => void closeBatch()}
        onOpenDestination={openDestination}
        onOpenBatch={openBatch}
        onRemoveSelectedFile={removeLocalFile}
        onDismissSelectionWarning={() => {
          setSelectionWarning(null)
          setSelectionSkippedFiles([])
        }}
        onRefresh={() => void refreshUploads()}
      />
    </AppShell>
  )
}
