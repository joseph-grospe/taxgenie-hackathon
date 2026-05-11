import { useNavigate } from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type {
  BatchDetailResponse,
  IntakeBatchView,
} from '@/lib/upload-intake-types'
import { AppShell } from '@/components/app-shell'
import { UploadBatchDetailPage } from '@/components/upload-batch-detail-page'
import { authClient } from '@/lib/auth-client'
import { defaultBatchSearch } from '@/lib/batch-search-state'
import {
  canAccessRoute,
  canExport,
  parseSessionContext,
} from '@/lib/access-control'
import { Button } from '@/components/ui/button'

const POLL_INTERVAL_MS = 8_000

type BatchDetailRouteContentProps = {
  batchId: string
  backTo: 'upload' | 'batches'
  backLabel: string
  title: string
  subtitle: string
}

export function BatchDetailRouteContent({
  batchId,
  backTo,
  backLabel,
  title,
  subtitle,
}: BatchDetailRouteContentProps) {
  const navigate = useNavigate()
  const { data: authSession } = authClient.useSession()
  const [uploadBatch, setUploadBatch] = useState<IntakeBatchView | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isClosingBatch, setIsClosingBatch] = useState(false)
  const [isReopeningBatch, setIsReopeningBatch] = useState(false)
  const [isExportingBir2307, setIsExportingBir2307] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const context = authSession?.user
    ? parseSessionContext(authSession.user)
    : null
  const canManageUpload = context
    ? canAccessRoute('upload', context.role)
    : false
  const canExportSheet = context
    ? canManageUpload && canExport.excel(context.role, context.canExportExcel)
    : false

  const refreshBatch = useCallback(async () => {
    setIsRefreshing(true)

    try {
      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(batchId)}`,
        {
          cache: 'no-store',
        },
      )

      const payload = (await response.json().catch(() => null)) as
        | (BatchDetailResponse & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load batch detail (${response.status}).`,
        )
      }

      setUploadBatch(payload?.batch ?? null)
      setLoadError(null)
    } catch (error) {
      setUploadBatch(null)
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load batch detail.',
      )
    } finally {
      setIsRefreshing(false)
    }
  }, [batchId])

  useEffect(() => {
    void refreshBatch()
    const interval = window.setInterval(() => {
      void refreshBatch()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [refreshBatch])

  const goBack = useCallback(() => {
    if (backTo === 'upload') {
      void navigate({ to: '/upload' })
      return
    }

    void navigate({ to: '/batches', search: defaultBatchSearch })
  }, [backTo, navigate])

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

  const openSigning = useCallback(() => {
    if (!canManageUpload) {
      return
    }

    void navigate({
      to: '/upload/batches/$batchId/sign',
      params: { batchId },
    })
  }, [batchId, canManageUpload, navigate])

  const closeBatch = useCallback(async () => {
    if (!canManageUpload || uploadBatch?.status !== 'open') {
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
        batch?: IntakeBatchView | null
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to close upload batch.')
      }

      setUploadBatch(payload?.batch ?? null)
      await refreshBatch()
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
  }, [canManageUpload, refreshBatch, uploadBatch?.status])

  const reopenBatch = useCallback(async () => {
    if (!canManageUpload || uploadBatch?.status !== 'closed') {
      return
    }

    setIsReopeningBatch(true)

    try {
      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(batchId)}/reopen`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        },
      )

      const payload = (await response.json().catch(() => null)) as {
        batch?: IntakeBatchView | null
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to re-open upload batch.')
      }

      setUploadBatch(payload?.batch ?? null)
      setLoadError(null)
      toast.success('Upload batch re-opened.')
      void navigate({ to: '/upload' })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to re-open upload batch.'
      setLoadError(message)
      toast.error(message)
    } finally {
      setIsReopeningBatch(false)
    }
  }, [batchId, canManageUpload, navigate, uploadBatch?.status])

  const renameBatch = useCallback(
    async (name: string | null) => {
      if (!canManageUpload) {
        return false
      }

      try {
        const response = await fetch(
          `/api/uploads/batches/${encodeURIComponent(batchId)}`,
          {
            method: 'PATCH',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({ name }),
          },
        )

        const payload = (await response.json().catch(() => null)) as {
          batch?: IntakeBatchView | null
          error?: string
        } | null

        if (!response.ok) {
          throw new Error(payload?.error || 'Unable to rename upload batch.')
        }

        if (!payload?.batch) {
          throw new Error('Unable to load renamed upload batch.')
        }

        setUploadBatch(payload.batch)
        setLoadError(null)
        toast.success('Upload batch renamed.')
        return true
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to rename upload batch.'
        setLoadError(message)
        toast.error(message)
        return false
      }
    },
    [batchId, canManageUpload],
  )

  const exportBir2307 = useCallback(async () => {
    if (!uploadBatch || uploadBatch.status !== 'closed' || !canExportSheet) {
      return
    }

    setIsExportingBir2307(true)

    try {
      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(batchId)}/bir2307/export`,
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null

        throw new Error(
          payload?.error ||
            `Failed to export extracted 2307 workbook (${response.status}).`,
        )
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') ?? ''
      const fileNameMatch =
        disposition.match(/filename="([^"]+)"/i) ??
        disposition.match(/filename=([^;]+)/i)
      const fileName = fileNameMatch?.[1]?.trim() ?? 'BIR-2307-Export.xlsx'

      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = fileName
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)

      toast.success('Export ready', {
        description: `${fileName} has been downloaded.`,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to export extracted 2307 workbook.',
      )
    } finally {
      setIsExportingBir2307(false)
    }
  }, [batchId, canExportSheet, uploadBatch])

  return (
    <AppShell
      title={title}
      subtitle={subtitle}
      leadingActions={
        <Button type="button" size="sm" variant="outline" onClick={goBack}>
          <IconArrowLeft data-icon="inline-start" />
          {backLabel}
        </Button>
      }
    >
      <UploadBatchDetailPage
        batch={uploadBatch}
        isRefreshing={isRefreshing}
        isClosingBatch={isClosingBatch}
        isReopeningBatch={isReopeningBatch}
        isExportingBir2307={isExportingBir2307}
        canManageBatchActions={canManageUpload}
        canExportSheet={canExportSheet}
        loadError={loadError}
        onCloseBatch={() => void closeBatch()}
        onReopenBatch={() => void reopenBatch()}
        onExportBir2307={() => void exportBir2307()}
        onOpenSigning={openSigning}
        onOpenDestination={openDestination}
        onRenameBatch={renameBatch}
      />
    </AppShell>
  )
}
