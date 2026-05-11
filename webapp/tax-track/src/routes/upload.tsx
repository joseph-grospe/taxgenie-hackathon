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
  UploadEntitiesResponse,
  UploadEntityOption,
} from '@/lib/upload-intake-types'
import {
  filterIntakeUploadFilesBySize,
  removeLocalSelectedFile,
  toServerStatus,
  xhrPut,
} from '@/lib/upload-intake-client'
import { defaultBatchSearch } from '@/lib/batch-search-state'
import { AppShell } from '@/components/app-shell'
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

export const Route = createFileRoute('/upload')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isBatchRoute =
    pathname !== '/upload' && pathname.startsWith('/upload/batches/')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const startUploadInFlightRef = useRef(false)
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

          return !knownUploadsById.has(item.uploadId)
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
        to: '/batches/$batchId',
        params: { batchId },
        search: defaultBatchSearch,
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
    setLocalFiles((current) => removeLocalSelectedFile(current, clientId))
  }, [])

  const uploadSelectedFile = useCallback(
    async (item: LocalUploadItem, presigned: PresignedUpload) => {
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

        await refreshUploads()
      } catch (error) {
        updateLocalFile(item.clientId, {
          status: 'Error',
          error: error instanceof Error ? error.message : 'Upload failed.',
        })

        await refreshUploads()
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
    setSelectionWarning(null)
    setLocalFiles((current) =>
      current.map((item) =>
        pendingItems.some((pending) => pending.clientId === item.clientId)
          ? { ...item, status: 'Requesting', error: null }
          : item,
      ),
    )

    try {
      const response = await fetch('/api/uploads/presign', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          batchId: activeBatch?.status === 'open' ? activeBatch.id : undefined,
          entityId: activeBatch?.entity ? undefined : selectedEntityId,
          files: pendingItems.map((item) => ({
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

      if (payload.uploads.length !== pendingItems.length) {
        throw new Error(
          'Upload preparation returned an unexpected number of files.',
        )
      }

      setLocalFiles((current) =>
        current.map((item) => {
          const pendingIndex = pendingItems.findIndex(
            (pending) => pending.clientId === item.clientId,
          )

          if (pendingIndex === -1) {
            return item
          }

          const presignedUpload = payload.uploads[pendingIndex]

          return {
            ...item,
            batchId: presignedUpload.batchId,
            uploadId: presignedUpload.uploadId,
          }
        }),
      )
      setActiveBatch(payload.batch)

      await Promise.allSettled(
        pendingItems.map((item, index) => {
          const presignedUpload = payload.uploads[index]
          return uploadSelectedFile(item, presignedUpload)
        }),
      )
    } catch (error) {
      setLocalFiles((current) =>
        current.map((item) =>
          pendingItems.some((pending) => pending.clientId === item.clientId)
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
  }, [activeBatch, localFiles, selectedEntityId, uploadSelectedFile])

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

    const selectedPdfFiles = Array.from(event.target.files ?? []).filter(
      (file) =>
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf'),
    )

    if (selectedPdfFiles.length === 0) {
      event.target.value = ''
      return
    }

    const { acceptedFiles, errorMessage } =
      filterIntakeUploadFilesBySize(selectedPdfFiles)

    if (acceptedFiles.length === 0) {
      setLoadError(null)
      setSelectionWarning(errorMessage)
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
    setSelectionWarning(errorMessage)
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
        onFilesSelected={handleFilesSelected}
        onEntityChange={setSelectedEntityId}
        onSelectFiles={selectFiles}
        onStartUpload={() => void startUpload()}
        onCloseBatch={() => void closeBatch()}
        onOpenDestination={openDestination}
        onOpenBatch={openBatch}
        onRemoveSelectedFile={removeLocalFile}
        onDismissSelectionWarning={() => setSelectionWarning(null)}
        onRefresh={() => void refreshUploads()}
      />
    </AppShell>
  )
}
