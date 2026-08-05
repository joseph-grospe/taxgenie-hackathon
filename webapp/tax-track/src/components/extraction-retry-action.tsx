import { IconLoader2, IconRefresh } from '@tabler/icons-react'

import type { ExtractionRetryView } from '@/lib/extraction-retry'
import { getExtractionRetryDisabledMessage } from '@/lib/extraction-retry-client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ExtractionRetryActionProps = {
  retry: ExtractionRetryView
  isRetrying?: boolean
  onRetry?: () => void
  className?: string
}

export function ExtractionRetryAction({
  retry,
  isRetrying = false,
  onRetry,
  className,
}: ExtractionRetryActionProps) {
  const descriptionId = `extraction-retry-description-${retry.sourceDocumentResultId}`
  const disabledReason = getExtractionRetryDisabledMessage(retry)
  const isAlreadyProcessing =
    retry.disabledReason === 'already_processing' && !isRetrying
  const actionLabel = isRetrying
    ? 'Queueing retry'
    : isAlreadyProcessing
      ? 'Extraction queued'
      : 'Retry extraction'
  const nextRetryNumber = Math.min(retry.retryCount + 1, retry.maxRetries)
  const retryContext =
    retry.disabledReason === 'limit_reached'
      ? `${retry.maxRetries} of ${retry.maxRetries} retries used.`
      : `Retry ${nextRetryNumber} of ${retry.maxRetries} · Uses the original PDF.`

  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      <Button
        type="button"
        size="sm"
        className="w-full sm:w-auto"
        disabled={isRetrying || !retry.canRetry || !onRetry}
        aria-describedby={descriptionId}
        onClick={onRetry}
      >
        {isRetrying ? (
          <IconLoader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <IconRefresh data-icon="inline-start" />
        )}
        {actionLabel}
      </Button>
      <div
        id={descriptionId}
        className="flex max-w-80 flex-col gap-0.5 text-xs text-muted-foreground"
      >
        <p>{retryContext}</p>
        {disabledReason ? <p>{disabledReason}</p> : null}
      </div>
    </div>
  )
}
