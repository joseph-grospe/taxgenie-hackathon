import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import {
  IconArrowUpRight,
  IconCheck,
  IconScale,
  IconSignature,
  IconX,
} from '@tabler/icons-react'
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
import { defaultReconciliationSearch } from '@/lib/reconciliation-search-state'
import { AppShell } from '@/components/app-shell'
import { authClient } from '@/lib/auth-client'
import { canSignCertificates, parseSessionContext } from '@/lib/access-control'
import { Button } from '@/components/ui/button'
import { useEntityScope } from '@/components/entity-scope-provider'
import { UploadIntakeTour } from '@/components/product-tour'
import { UploadIntakePage } from '@/components/upload-intake-page'
import { cn } from '@/lib/utils'

const POLL_INTERVAL_MS = 8_000

type UploadStatusSheetTourTab = 'summary' | 'issues' | 'rules'

type UploadStatusSheetTourRequest = {
  id: number
  open: boolean
  tab?: UploadStatusSheetTourTab
}

export type UploadBatchNextStepAction = {
  kind: 'sign' | 'reconcile' | 'open'
  label: string
  batchId: string
  entityId?: number
}

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

export const buildUploadBatchNextStepActions = (
  batch: IntakeBatchView | null | undefined,
  options: { canAccessSigning: boolean },
): Array<UploadBatchNextStepAction> => {
  if (!batch || batch.status !== 'closed') {
    return []
  }

  const actions: Array<UploadBatchNextStepAction> = []
  const canOpenSigning =
    options.canAccessSigning &&
    (batch.canSignBatch || batch.batchSigningStatus === 'signed')

  if (canOpenSigning) {
    actions.push({
      kind: 'sign',
      label: 'Sign certificates',
      batchId: batch.id,
    })
  }

  if (batch.entity?.id && batch.counts.success > 0) {
    actions.push({
      kind: 'reconcile',
      label: 'Reconcile batch',
      batchId: batch.id,
      entityId: batch.entity.id,
    })
  }

  return actions.length > 0
    ? actions
    : [
        {
          kind: 'open',
          label: 'Open batch',
          batchId: batch.id,
        },
      ]
}

export const buildUploadBatchClosedFlagModel = (
  batch: IntakeBatchView,
  options: {
    canAccessSigning: boolean
  },
) => {
  const actions = buildUploadBatchNextStepActions(batch, {
    canAccessSigning: options.canAccessSigning,
  })

  return {
    description:
      actions.length > 1
        ? 'Choose the next step for this batch.'
        : 'Continue with the next step for this batch.',
    duration: 10_000,
    position: 'bottom-right' as const,
    actions,
  }
}

const getBatchFlagDisplayName = (batch: IntakeBatchView) => batch.name ?? batch.id

const getNextStepActionIcon = (kind: UploadBatchNextStepAction['kind']) => {
  if (kind === 'sign') {
    return <IconSignature data-icon="inline-start" />
  }

  if (kind === 'reconcile') {
    return <IconScale data-icon="inline-start" />
  }

  return <IconArrowUpRight data-icon="inline-start" />
}

const getNextStepActionButtonLabel = (
  kind: UploadBatchNextStepAction['kind'],
) => {
  if (kind === 'sign') return 'Sign'
  if (kind === 'reconcile') return 'Reconcile'
  return 'Open batch'
}

export function UploadBatchClosedFlag({
  actions,
  batch,
  description,
  toastId,
  onAction,
}: {
  actions: Array<UploadBatchNextStepAction>
  batch: IntakeBatchView
  description: string
  toastId: string | number
  onAction: (action: UploadBatchNextStepAction) => void
}) {
  const batchName = getBatchFlagDisplayName(batch)

  return (
    <div className="w-[23rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border/70 bg-background p-3 text-foreground shadow-lg">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          <IconCheck className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Batch closed</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {batchName}
              </p>
            </div>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Dismiss batch closed flag"
              className="-mr-1 -mt-1"
              onClick={() => toast.dismiss(toastId)}
            >
              <IconX />
            </Button>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
          <div className="mt-3 flex flex-nowrap items-center gap-2">
            {actions.map((action, index) => (
              <Button
                key={action.kind}
                type="button"
                size="sm"
                variant={index === 0 ? 'default' : 'outline'}
                aria-label={action.label}
                className={cn(
                  'h-8 shrink-0 px-2.5',
                  index > 0 && 'bg-background',
                )}
                onClick={() => {
                  toast.dismiss(toastId)
                  onAction(action)
                }}
              >
                {getNextStepActionIcon(action.kind)}
                {getNextStepActionButtonLabel(action.kind)}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/upload')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const { data: authSession } = authClient.useSession()
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
  const [tourStartSignal, setTourStartSignal] = useState(0)
  const [statusSheetTourRequest, setStatusSheetTourRequest] =
    useState<UploadStatusSheetTourRequest | null>(null)
  const selectionSkippedCount = selectionSkippedFiles.length
  const accessContext = authSession?.user
    ? parseSessionContext(authSession.user)
    : null
  const canAccessSigning = canSignCertificates(accessContext)

  const handleStatusSheetTourChange = useCallback(
    (change: { open: boolean; tab?: UploadStatusSheetTourTab }) => {
      setStatusSheetTourRequest((current) => ({
        id: (current?.id ?? 0) + 1,
        ...change,
      }))
    },
    [],
  )

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

  const openBatchNextStep = useCallback(
    (action: UploadBatchNextStepAction) => {
      if (action.kind === 'sign') {
        void navigate({
          to: '/upload/batches/$batchId/sign',
          params: { batchId: action.batchId },
          search: defaultBatchDetailSearch,
        })
        return
      }

      if (action.kind === 'reconcile' && action.entityId) {
        void navigate({
          to: '/reconciliation',
          search: {
            ...defaultReconciliationSearch,
            entityId: String(action.entityId),
          },
        })
        return
      }

      void navigate({
        to: '/upload/batches/$batchId',
        params: { batchId: action.batchId },
        search: defaultBatchDetailSearch,
      })
    },
    [navigate],
  )

  const showBatchClosedFlag = useCallback(
    (batch: IntakeBatchView) => {
      const flagModel = buildUploadBatchClosedFlagModel(batch, {
        canAccessSigning,
      })

      toast.custom(
        (toastId) => (
          <UploadBatchClosedFlag
            actions={flagModel.actions}
            batch={batch}
            description={flagModel.description}
            toastId={toastId}
            onAction={openBatchNextStep}
          />
        ),
        {
          duration: flagModel.duration,
          position: flagModel.position,
        },
      )
    },
    [canAccessSigning, openBatchNextStep],
  )

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
        body: JSON.stringify({ batchId: activeBatch.id }),
      })

      const payload = (await response.json().catch(() => null)) as {
        batch?: IntakeBatchView | null
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to close upload batch.')
      }

      if (!payload?.batch) {
        throw new Error('Unable to load closed upload batch.')
      }

      await refreshUploads()
      showBatchClosedFlag(payload.batch)
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to close upload batch.',
      )
    } finally {
      setIsClosingBatch(false)
    }
  }, [activeBatch, refreshUploads, showBatchClosedFlag])

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
      pageHelp={{
        onStartTour: () => setTourStartSignal((current) => current + 1),
      }}
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
        statusSheetTourRequest={statusSheetTourRequest}
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
      <UploadIntakeTour
        startSignal={tourStartSignal}
        onStatusSheetTourChange={handleStatusSheetTourChange}
      />
    </AppShell>
  )
}
