import {
  IconAlertTriangle,
  IconCloudUpload,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'

import { AppShell } from '@/components/app-shell'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type BatchFileView = {
  id: string
  batchId: string
  fileName: string
  sizeBytes: number
  uploadStatus: string
  queueStatus: string
  processingStatus: string
  overallStatus: string
  currentPhase: string | null
  currentStep: string | null
  errorMessage: string | null
  worker: {
    jobId: string
    status: string
    currentPhase: string | null
    currentStep: string | null
  } | null
}

type BatchView = {
  id: string
  status: string
  totalFiles: number
  createdAt: string
  updatedAt: string
  counts: Record<string, number>
  files: Array<BatchFileView>
}

type PresignedUpload = {
  uploadId: string
  fileName: string
  sizeBytes: number
  mimeType: string
  storageKey: string
  method: 'PUT'
  url: string
  headers: Record<string, string>
}

type PresignResponse = {
  batchId: string
  uploads: Array<PresignedUpload>
}

type LocalUploadItem = {
  clientId: string
  file: File
  progress: number
  status: string
  error: string | null
  uploadId: string | null
  batchId: string | null
}

const POLL_INTERVAL_MS = 8_000

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const toServerStatus = (status: string) => {
  switch (status) {
    case 'success':
      return 'Done'
    case 'duplicate':
      return 'Duplicate'
    case 'error':
      return 'Error'
    case 'processing':
      return 'Processing'
    case 'queued':
      return 'Queued'
    case 'uploaded':
      return 'Uploaded'
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
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [localUploads, setLocalUploads] = useState<Array<LocalUploadItem>>([])
  const [batches, setBatches] = useState<Array<BatchView>>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshBatches = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/uploads/batches', {
        cache: 'no-store',
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(payload?.error || `Failed to load batches (${response.status}).`)
      }

      const payload = (await response.json()) as { batches?: Array<BatchView> }
      setBatches(Array.isArray(payload.batches) ? payload.batches : [])
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load batches.')
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    refreshBatches()
    const interval = window.setInterval(refreshBatches, POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [refreshBatches])

  useEffect(() => {
    if (batches.length === 0) {
      return
    }

    const fileMap = new Map(
      batches.flatMap((batch) =>
        batch.files.map((file) => [file.id, { batchId: batch.id, file }] as const),
      ),
    )

    setLocalUploads((current) =>
      current.map((item) => {
        if (!item.uploadId) {
          return item
        }

        const match = fileMap.get(item.uploadId)
        if (!match) {
          return item
        }

        return {
          ...item,
          batchId: match.batchId,
          status: toServerStatus(match.file.overallStatus),
          error: match.file.errorMessage,
        }
      }),
    )
  }, [batches])

  const queueMetrics = useMemo(() => {
    return batches.reduce(
      (acc, batch) => {
        acc.totalFiles += batch.totalFiles
        acc.queued += batch.counts.queued ?? 0
        acc.processing += batch.counts.processing ?? 0
        acc.success += batch.counts.success ?? 0
        acc.duplicate += batch.counts.duplicate ?? 0
        acc.error += batch.counts.error ?? 0
        return acc
      },
      {
        totalFiles: 0,
        queued: 0,
        processing: 0,
        success: 0,
        duplicate: 0,
        error: 0,
      },
    )
  }, [batches])

  const updateLocalUpload = useCallback(
    (clientId: string, patch: Partial<LocalUploadItem>) => {
      setLocalUploads((current) =>
        current.map((item) =>
          item.clientId === clientId ? { ...item, ...patch } : item,
        ),
      )
    },
    [],
  )

  const uploadSingleItem = useCallback(
    async (item: LocalUploadItem, presigned: PresignedUpload, batchId: string) => {
      updateLocalUpload(item.clientId, {
        uploadId: presigned.uploadId,
        batchId,
        status: 'Uploading',
        progress: 0,
        error: null,
      })

      try {
        await xhrPut(presigned.url, item.file, presigned.headers, (progress) => {
          updateLocalUpload(item.clientId, { progress, status: 'Uploading' })
        })

        updateLocalUpload(item.clientId, {
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

        updateLocalUpload(item.clientId, {
          status: 'Queued',
          error: null,
        })

        await refreshBatches()
      } catch (error) {
        updateLocalUpload(item.clientId, {
          status: 'Error',
          error: error instanceof Error ? error.message : 'Upload failed.',
        })
      }
    },
    [refreshBatches, updateLocalUpload],
  )

  const startUploads = useCallback(
    async (items: Array<LocalUploadItem>) => {
      if (items.length === 0) {
        return
      }

      setLocalUploads((current) =>
        current.map((item) =>
          items.some((candidate) => candidate.clientId === item.clientId)
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
            files: items.map((item) => ({
              name: item.file.name,
              type: item.file.type || 'application/pdf',
              size: item.file.size,
            })),
          }),
        })

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string
          } | null
          throw new Error(payload?.error || 'Unable to prepare upload batch.')
        }

        const payload = (await response.json()) as PresignResponse
        await Promise.allSettled(
          items.map((item, index) =>
            uploadSingleItem(item, payload.uploads[index], payload.batchId),
          ),
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to create upload batch.'
        setLocalUploads((current) =>
          current.map((item) =>
            items.some((candidate) => candidate.clientId === item.clientId)
              ? { ...item, status: 'Error', error: message }
              : item,
          ),
        )
      }
    },
    [uploadSingleItem],
  )

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter(
      (file) =>
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    )

    if (files.length === 0) {
      return
    }

    const nextItems = files.map<LocalUploadItem>((file) => ({
      clientId: globalThis.crypto.randomUUID(),
      file,
      progress: 0,
      status: 'Pending',
      error: null,
      uploadId: null,
      batchId: null,
    }))

    setLocalUploads((current) => [...nextItems, ...current])
    event.target.value = ''
  }

  const readyItems = localUploads.filter((item) => item.status === 'Pending')

  return (
    <AppShell
      title="Upload Intake"
      subtitle="Upload BIR 2307 PDFs directly to TaxTrack and queue them for processing."
      actions={
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={handleFilesSelected}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            <IconUpload className="size-4" />
            Select files
          </Button>
          <Button
            size="sm"
            onClick={() => void startUploads(readyItems)}
            disabled={readyItems.length === 0}
          >
            <IconCloudUpload className="size-4" />
            Start upload
          </Button>
        </div>
      }
    >
      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <div className="flex items-start gap-2">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Queued" value={queueMetrics.queued} />
        <MetricCard label="Processing" value={queueMetrics.processing} />
        <MetricCard label="Done" value={queueMetrics.success} />
        <MetricCard
          label="Exceptions"
          value={queueMetrics.error + queueMetrics.duplicate}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current upload session</CardTitle>
          <CardDescription>
            Files in this browser session. Each file is queued as soon as its S3
            upload completes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {localUploads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
              Select one or more PDF files to start a new intake batch.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localUploads.map((item) => (
                  <TableRow key={item.clientId}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{item.file.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(item.file.size)}
                        </span>
                        {item.error ? (
                          <span className="text-xs text-rose-600">
                            {item.error}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill status={item.status} />
                    </TableCell>
                    <TableCell>{item.progress}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.batchId ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.status === 'Error' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void startUploads([item])}
                        >
                          Retry
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Recent intake batches</CardTitle>
              <CardDescription>
                Latest persisted upload batches and their live worker state.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refreshBatches()}
              disabled={isRefreshing}
            >
              <IconRefresh className="size-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {batches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
              No upload batches yet.
            </div>
          ) : (
            batches.map((batch) => (
              <div
                key={batch.id}
                className="rounded-2xl border border-border/60 bg-muted/20"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{batch.id}</span>
                      <StatusPill status={toServerStatus(batch.status)} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDate(batch.createdAt)} • Updated{' '}
                      {formatDate(batch.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{batch.totalFiles} files</Badge>
                    <Badge variant="outline">Queued {batch.counts.queued ?? 0}</Badge>
                    <Badge variant="outline">
                      Processing {batch.counts.processing ?? 0}
                    </Badge>
                    <Badge variant="outline">Done {batch.counts.success ?? 0}</Badge>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Phase</TableHead>
                        <TableHead>Step</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batch.files.map((file) => (
                        <TableRow key={file.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{file.fileName}</span>
                              <span className="text-xs text-muted-foreground">
                                {formatBytes(file.sizeBytes)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusPill status={toServerStatus(file.overallStatus)} />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {file.currentPhase ?? 'upload'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {file.currentStep ?? file.queueStatus}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AppShell>
  )
}

function MetricCard({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-2 text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}
