import {
  IconDownload,
  IconFileSpreadsheet,
  IconLoader2,
  IconMail,
} from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import type {
  ReconciliationEmailPreviewPayload,
  ReconciliationEmailPreviewRow,
} from '@/lib/reconciliation-email-preview-types'
import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { downloadResponseAttachment } from '@/lib/download-client'
import { cn } from '@/lib/utils'

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const FALLBACK_ATTACHMENT_FILE_NAME =
  'Outstanding-CWT-Reconciliation-Report.xlsx'

const formatAmount = (value: number | null) =>
  value === null ? '—' : NUMBER_FORMATTER.format(value)

const formatText = (value: string | null) => value || '—'

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const readJsonPayload = async (response: Response) =>
  (await response.json().catch(() => null)) as
    | (Partial<ReconciliationEmailPreviewPayload> & { error?: string })
    | null

const previewColumns: Array<{
  key: keyof ReconciliationEmailPreviewRow
  label: string
  align?: 'right'
  render?: (row: ReconciliationEmailPreviewRow) => string
}> = [
  {
    key: 'shortName',
    label: 'Short Name',
    render: (row) => formatText(row.shortName),
  },
  { key: 'tin', label: 'TIN', render: (row) => formatText(row.tin) },
  {
    key: 'customerName',
    label: 'Customer Name',
    render: (row) => formatText(row.customerName),
  },
  {
    key: 'invoiceNumber',
    label: 'Invoice Number',
    render: (row) => formatText(row.invoiceNumber),
  },
  {
    key: 'billingMonthMMYY',
    label: 'Billing Month',
    render: (row) => row.billingMonthMMYY,
  },
  {
    key: 'accountingDate',
    label: 'Accounting Date',
    render: (row) => formatText(row.accountingDate),
  },
  {
    key: 'taxableSales',
    label: 'Taxable Sales',
    align: 'right',
    render: (row) => formatAmount(row.taxableSales),
  },
  {
    key: 'prepaidCWT',
    label: 'Prepaid CWT',
    align: 'right',
    render: (row) => formatAmount(row.prepaidCWT),
  },
  {
    key: 'collectedTaxBase',
    label: 'Collected Tax Base',
    align: 'right',
    render: (row) => formatAmount(row.collectedTaxBase),
  },
  {
    key: 'collectedPrepaidCWT',
    label: 'Collected Prepaid CWT',
    align: 'right',
    render: (row) => formatAmount(row.collectedPrepaidCWT),
  },
  {
    key: 'taxBaseDifference',
    label: 'Tax Base Difference',
    align: 'right',
    render: (row) => formatAmount(row.taxBaseDifference),
  },
  {
    key: 'prepaidCWTDifference',
    label: 'Prepaid CWT Difference',
    align: 'right',
    render: (row) => formatAmount(row.prepaidCWTDifference),
  },
]

type ReconciliationEmailPreviewSheetProps = {
  open: boolean
  row: ReconciliationRowView | null
  onOpenChange: (open: boolean) => void
  onSendEmail: (row: ReconciliationRowView) => void
  isSending?: boolean
  canDownloadAttachment?: boolean
}

type ReconciliationEmailPreviewSheetViewProps =
  ReconciliationEmailPreviewSheetProps & {
    preview: ReconciliationEmailPreviewPayload | null
    loadError: string | null
    isLoading: boolean
    isDownloading: boolean
    onDownloadAttachment: () => void
  }

function RecipientLine({
  label,
  values,
}: {
  label: string
  values: Array<string>
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.68rem] font-medium uppercase tracking-normal text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">
        {values.length > 0 ? values.join(', ') : '—'}
      </dd>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12 sm:col-span-2" />
      </div>
      <Skeleton className="h-28" />
      <Skeleton className="h-64" />
    </div>
  )
}

export function ReconciliationEmailPreviewSheetView({
  open,
  row,
  onOpenChange,
  onSendEmail,
  preview,
  loadError,
  isLoading,
  isSending = false,
  isDownloading,
  canDownloadAttachment = false,
  onDownloadAttachment,
}: ReconciliationEmailPreviewSheetViewProps) {
  const canSend = Boolean(row && preview && !loadError && !isLoading)
  const rowCountLabel =
    preview?.rowCount === 1
      ? '1 workbook row'
      : `${(preview?.rowCount ?? 0).toLocaleString()} workbook rows`
  const attachmentFooterLabel =
    preview?.attachmentFileName ?? FALLBACK_ATTACHMENT_FILE_NAME
  const footerStatusLabel = preview
    ? rowCountLabel
    : isLoading
      ? 'Loading preview...'
      : 'Preview unavailable'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="h-dvh max-h-dvh !w-[min(92vw,760px)] overflow-hidden sm:!max-w-none">
        <SheetHeader className="border-b border-border/60 pr-14">
          <div className="flex min-w-0 items-center gap-2">
            <IconFileSpreadsheet className="text-muted-foreground" />
            <SheetTitle className="truncate">
              Preview reconciliation email
            </SheetTitle>
          </div>
          <SheetDescription className="truncate">
            {preview
              ? `${preview.customerName} · ${preview.attachmentFileName}`
              : row
                ? `Review the attachment rows before emailing ${row.customerName}.`
                : 'Review the attachment rows before sending.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          {isLoading ? <PreviewSkeleton /> : null}

          {!isLoading && loadError ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to load preview</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : null}

          {!isLoading && preview ? (
            <>
              <dl className="grid gap-3 rounded-md border border-border/60 bg-muted/20 p-3 sm:grid-cols-2">
                <RecipientLine label="To" values={preview.to} />
                <RecipientLine label="Cc" values={preview.cc} />
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-[0.68rem] font-medium uppercase tracking-normal text-muted-foreground">
                    Subject
                  </dt>
                  <dd className="mt-1 truncate text-sm text-foreground">
                    {preview.subject}
                  </dd>
                </div>
              </dl>

              <section className="rounded-md border border-border/60 bg-background">
                <div className="border-b border-border/60 px-3 py-2">
                  <h3 className="text-sm font-semibold">Email body</h3>
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap p-3 font-sans text-sm leading-6 text-muted-foreground">
                  {preview.body}
                </pre>
              </section>

              <section className="min-h-0 rounded-md border border-border/60 bg-background">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                  <h3 className="text-sm font-semibold">Attachment preview</h3>
                  <span className="text-xs text-muted-foreground">
                    {rowCountLabel}
                  </span>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <Table className="text-xs">
                    <TableHeader className="sticky top-0 bg-background [&_th]:bg-muted/35">
                      <TableRow>
                        {previewColumns.map((column) => (
                          <TableHead
                            key={column.key}
                            className={cn(
                              'h-9 text-[0.68rem] uppercase tracking-normal text-muted-foreground',
                              column.align === 'right' && 'text-right',
                            )}
                          >
                            {column.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((previewRow, index) => (
                        <TableRow key={`${previewRow.invoiceNumber}-${index}`}>
                          {previewColumns.map((column) => (
                            <TableCell
                              key={column.key}
                              className={cn(
                                'max-w-48 truncate py-2',
                                column.align === 'right' && 'text-right',
                              )}
                            >
                              {column.render?.(previewRow) ??
                                String(previewRow[column.key] ?? '—')}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </>
          ) : null}
        </div>

        <SheetFooter className="sticky bottom-0 mt-0 shrink-0 border-t border-border/60 bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4">
          <div className="flex w-full flex-col gap-3">
            <div className="grid min-w-0 gap-1 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <p className="truncate font-medium text-foreground">
                {attachmentFooterLabel}
              </p>
              <p className="shrink-0">{footerStatusLabel}</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => onOpenChange(false)}
                disabled={isSending || isDownloading}
              >
                Close
              </Button>
              {canDownloadAttachment ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={!preview || isDownloading || isSending}
                  onClick={onDownloadAttachment}
                >
                  {isDownloading ? (
                    <IconLoader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <IconDownload data-icon="inline-start" />
                  )}
                  {isDownloading ? 'Downloading...' : 'Download attachment'}
                </Button>
              ) : null}
              <Button
                type="button"
                className="w-full sm:w-auto sm:min-w-36"
                disabled={!canSend || isSending || isDownloading}
                onClick={() => {
                  if (row) onSendEmail(row)
                }}
              >
                {isSending ? (
                  <IconLoader2
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <IconMail data-icon="inline-start" />
                )}
                {isSending ? 'Sending...' : 'Send email'}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function ReconciliationEmailPreviewSheet({
  open,
  row,
  onOpenChange,
  onSendEmail,
  isSending = false,
  canDownloadAttachment = false,
}: ReconciliationEmailPreviewSheetProps) {
  const [preview, setPreview] =
    useState<ReconciliationEmailPreviewPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const rowId = row?.id ?? null

  useEffect(() => {
    if (!open || rowId === null) {
      setPreview(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false

    const loadPreview = async () => {
      setIsLoading(true)
      setLoadError(null)

      try {
        const response = await fetch(
          `/api/reconciliation/${rowId}/email-preview`,
          {
            cache: 'no-store',
          },
        )
        const payload = await readJsonPayload(response)

        if (!response.ok) {
          throw new Error(
            payload?.error ||
              `Failed to load reconciliation email preview (${response.status}).`,
          )
        }

        if (!cancelled) {
          setPreview(payload as ReconciliationEmailPreviewPayload)
        }
      } catch (error) {
        if (!cancelled) {
          setPreview(null)
          setLoadError(
            getErrorMessage(
              error,
              'Unable to load reconciliation email preview.',
            ),
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadPreview()

    return () => {
      cancelled = true
    }
  }, [open, rowId])

  const handleDownloadAttachment = async () => {
    if (rowId === null) return

    setIsDownloading(true)
    try {
      const response = await fetch(
        `/api/reconciliation/${rowId}/email-attachment`,
        {
          cache: 'no-store',
        },
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null

        throw new Error(
          payload?.error ||
            `Failed to download reconciliation email attachment (${response.status}).`,
        )
      }

      const fileName = await downloadResponseAttachment(
        response,
        preview?.attachmentFileName ?? FALLBACK_ATTACHMENT_FILE_NAME,
      )

      toast.success('Attachment downloaded', {
        description: fileName,
      })
    } catch (error) {
      toast.error('Unable to download reconciliation attachment.', {
        description: getErrorMessage(
          error,
          'Unable to download reconciliation attachment.',
        ),
      })
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <ReconciliationEmailPreviewSheetView
      open={open}
      row={row}
      onOpenChange={onOpenChange}
      onSendEmail={onSendEmail}
      isSending={isSending}
      canDownloadAttachment={canDownloadAttachment}
      preview={preview}
      loadError={loadError}
      isLoading={isLoading}
      isDownloading={isDownloading}
      onDownloadAttachment={() => void handleDownloadAttachment()}
    />
  )
}
