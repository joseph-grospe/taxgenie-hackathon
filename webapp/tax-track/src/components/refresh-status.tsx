import { IconRefresh } from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type RefreshStatusProps = {
  className?: string
  disabled?: boolean
  isRefreshing?: boolean
  lastUpdatedLabel: string
  liveLabel?: string
  onRefresh: () => void
  refreshLabel?: string
  showLastUpdated?: boolean
}

export function RefreshStatus({
  className,
  disabled = false,
  isRefreshing = false,
  lastUpdatedLabel,
  liveLabel,
  onRefresh,
  refreshLabel = 'Refresh',
  showLastUpdated = false,
}: RefreshStatusProps) {
  const hasKnownTimestamp = lastUpdatedLabel !== 'Not updated yet'
  const tooltipLabel = isRefreshing ? 'Refreshing' : refreshLabel

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center justify-end gap-2',
        className,
      )}
    >
      {liveLabel ? (
        <p
          key="live-label"
          className="hidden text-xs text-muted-foreground lg:block"
        >
          {liveLabel}
        </p>
      ) : null}
      {showLastUpdated ? (
        <p
          key="last-updated"
          className="min-w-0 text-xs text-muted-foreground"
        >
          {hasKnownTimestamp ? (
            <>
              <span key="desktop-label" className="hidden sm:inline">
                Last updated{' '}
              </span>
              <span key="mobile-label" className="sm:hidden">
                Updated{' '}
              </span>
              <span key="timestamp" className="font-medium text-foreground">
                {lastUpdatedLabel}
              </span>
            </>
          ) : (
            <span>Not updated yet</span>
          )}
        </p>
      ) : null}
      <Button
        key="refresh-button"
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={refreshLabel}
        title={tooltipLabel}
        disabled={disabled || isRefreshing}
        onClick={onRefresh}
      >
        <IconRefresh
          key="refresh-icon"
          data-icon="inline-start"
          className={cn(isRefreshing && 'animate-spin')}
        />
      </Button>
    </div>
  )
}
