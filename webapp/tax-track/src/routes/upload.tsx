import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ChangeEvent } from 'react'

import type {
  IntakeUploadView,
  LocalUploadItem,
  PresignResponse,
  PresignedUpload,
  StatusSummary,
} from '@/lib/upload-intake-types'
import { AppShell } from '@/components/app-shell'
import { UploadIntakePage } from '@/components/upload-intake-page'

const POLL_INTERVAL_MS = 8_000

const EMPTY_SUMMARY: StatusSummary = {
  pending: 0,
  uploaded: 0,
  queued: 0,
  processing: 0,
  success: 0,
  duplicate: 0,
  error: 0,
}

const toServerStatus = (status: string): LocalUploadItem['status'] => {
  switch (status) {
    case 'success':
    case 'completed':
      return 'Done'
    case 'duplicate':
      return 'Duplicate'
    case 'error':
      return 'Error'
    case 'processing':
      return 'Processing'
    case 'queued':
    case 'uploaded':
      return 'Queued'
    default:
      return 'Pending'
  }
}

const xhrPut = (
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (value: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    Object.entries(headers).forEach(([key, value]) => {
      request.setRequestHeader(key, value)
    })
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return
      }

      onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        resolve()
        return
      }

      reject(new Error(`Upload failed with status ${request.status}.`))
    }
    request.onerror = () => reject(new Error('Network error during S3 upload.'))
    request.send(file)
  })

export const Route = createFileRoute('/upload')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [localUpload, setLocalUpload] = useState<LocalUploadItem | null>(null)
  const [recentUploads, setRecentUploads] = useState<Array<IntakeUploadView>>(
    [],
  )
  const [summary, setSummary] = useState<StatusSummary>(EMPTY_SUMMARY)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [resolvingAttentionIds, setResolvingAttentionIds] = useState<
    Array<string>
  >([])

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

      const payload = (await response.json()) as {
        uploads?: Array<IntakeUploadView>
        summary?: Partial<StatusSummary>
      }
      setRecentUploads(Array.isArray(payload.uploads) ? payload.uploads : [])
      setSummary({
        pending: payload.summary?.pending ?? 0,
        uploaded: payload.summary?.uploaded ?? 0,
        queued: payload.summary?.queued ?? 0,
        processing: payload.summary?.processing ?? 0,
        success: payload.summary?.success ?? 0,
        duplicate: payload.summary?.duplicate ?? 0,
        error: payload.summary?.error ?? 0,
      })
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
    void refreshUploads()
    const interval = window.setInterval(() => {
      void refreshUploads()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [refreshUploads])

  useEffect(() => {
    if (!localUpload?.uploadId) {
      return
    }

    const match = recentUploads.find(
      (upload) => upload.id === localUpload.uploadId,
    )
    if (!match) {
      return
    }

    setLocalUpload((current) => {
      if (!current || current.uploadId !== match.id) {
        return current
      }

      return {
        ...current,
        progress: current.progress < 100 ? 100 : current.progress,
        status: toServerStatus(match.overallStatus),
        error: match.errorMessage,
      }
    })
  }, [localUpload?.uploadId, recentUploads])

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

  const resolveAttention = useCallback(
    async (uploadId: string) => {
      setResolvingAttentionIds((current) =>
        current.includes(uploadId) ? current : [...current, uploadId],
      )

      try {
        const response = await fetch('/api/uploads/resolve-attention', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ uploadId }),
        })

        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null

        if (!response.ok) {
          throw new Error(
            payload?.error ||
              `Failed to resolve upload issue (${response.status}).`,
          )
        }

        await refreshUploads()
        setLoadError(null)
        toast.success('Upload removed from Needs Attention.')
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to resolve upload issue.',
        )
      } finally {
        setResolvingAttentionIds((current) =>
          current.filter((id) => id !== uploadId),
        )
      }
    },
    [refreshUploads],
  )

  const updateLocalUpload = useCallback((patch: Partial<LocalUploadItem>) => {
    setLocalUpload((current) => (current ? { ...current, ...patch } : current))
  }, [])

  const uploadSelectedFile = useCallback(
    async (item: LocalUploadItem, presigned: PresignedUpload) => {
      updateLocalUpload({
        uploadId: presigned.uploadId,
        status: 'Uploading',
        progress: 0,
        error: null,
      })

      try {
        await xhrPut(
          presigned.url,
          item.file,
          presigned.headers,
          (progress) => {
            updateLocalUpload({ progress, status: 'Uploading' })
          },
        )

        updateLocalUpload({
          progress: 100,
          status: 'Queueing',
        })

        const completeResponse = await fetch('/api/uploads/complete', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ uploadId: presigned.uploadId }),
        })

        if (!completeResponse.ok) {
          const payload = (await completeResponse.json().catch(() => null)) as {
            error?: string
          } | null
          throw new Error(payload?.error || 'Unable to queue uploaded file.')
        }

        const payload = (await completeResponse.json()) as {
          upload?: IntakeUploadView
        }

        updateLocalUpload({
          status: toServerStatus(payload.upload?.overallStatus ?? 'queued'),
          error: payload.upload?.errorMessage ?? null,
        })

        await refreshUploads()
      } catch (error) {
        updateLocalUpload({
          status: 'Error',
          error: error instanceof Error ? error.message : 'Upload failed.',
        })
      }
    },
    [refreshUploads, updateLocalUpload],
  )

  const startUpload = useCallback(async () => {
    if (!localUpload || !['Pending', 'Error'].includes(localUpload.status)) {
      return
    }

    updateLocalUpload({ status: 'Requesting', error: null })

    try {
      const response = await fetch('/api/uploads/presign', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          file: {
            name: localUpload.file.name,
            type: localUpload.file.type || 'application/pdf',
            size: localUpload.file.size,
          },
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(payload?.error || 'Unable to prepare upload.')
      }

      const payload = (await response.json()) as PresignResponse
      await uploadSelectedFile(localUpload, payload.upload)
    } catch (error) {
      updateLocalUpload({
        status: 'Error',
        error:
          error instanceof Error ? error.message : 'Unable to start upload.',
      })
    }
  }, [localUpload, updateLocalUpload, uploadSelectedFile])

  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []).find(
      (file) =>
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf'),
    )

    if (!selected) {
      return
    }

    setLocalUpload({
      clientId: globalThis.crypto.randomUUID(),
      file: selected,
      progress: 0,
      status: 'Pending',
      error: null,
      uploadId: null,
    })
    event.target.value = ''
  }

  return (
    <AppShell
      title="Upload Intake"
      subtitle="Upload a PDF containing one or more BIR 2307 certificates. We detect certificate pages, ignore non-2307 pages, and save results only after full validation."
    >
      <UploadIntakePage
        inputRef={inputRef}
        localUpload={localUpload}
        recentUploads={recentUploads}
        summary={summary}
        isRefreshing={isRefreshing}
        loadError={loadError}
        resolvingAttentionIds={resolvingAttentionIds}
        onFilesSelected={handleFilesSelected}
        onOpenDestination={openDestination}
        onRefresh={() => void refreshUploads()}
        onResolveAttention={(uploadId) => void resolveAttention(uploadId)}
        onSelectFile={() => inputRef.current?.click()}
        onStartUpload={() => void startUpload()}
      />
    </AppShell>
  )
}
