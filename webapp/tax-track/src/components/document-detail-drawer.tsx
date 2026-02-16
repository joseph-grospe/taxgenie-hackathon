import { IconExternalLink, IconX } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'

import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'

type DocumentLog = {
  timestamp: string
  level: 'info' | 'warning' | 'error'
  message: string
}

type DocumentError = {
  code: string
  stage: string
  message: string
}

type DocumentProcessing = {
  startedAt?: string
  updatedAt?: string
  worker?: string
  elapsed?: string
}

type DocumentTrailStep = {
  label: string
  status: 'complete' | 'active' | 'pending' | 'error'
  detail?: string
}

type DocumentDetailDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string
  status?: string
  stage?: string
  nextStep?: string
  confidence?: string
  atc?: string
  payee?: string
  meta?: Array<{ label: string; value: string }>
  processing?: DocumentProcessing
  trail?: Array<DocumentTrailStep>
  logs?: Array<DocumentLog>
  errors?: Array<DocumentError>
  openTo?: string
}

const logLevelStyles: Record<string, string> = {
  info: 'border-border/60 text-muted-foreground',
  warning: 'border-amber-500/30 text-amber-700',
  error: 'border-rose-500/30 text-rose-700',
}

const trailStyles: Record<DocumentTrailStep['status'], string> = {
  complete: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700',
  active: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700',
  pending: 'border-border/60 bg-muted/40 text-muted-foreground',
  error: 'border-rose-500/25 bg-rose-500/10 text-rose-700',
}

export function DocumentDetailDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  status,
  stage,
  nextStep,
  confidence,
  atc,
  payee,
  meta,
  processing,
  trail,
  logs,
  errors,
  openTo,
}: DocumentDetailDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent
        className={cn(
          'data-[vaul-drawer-direction=right]:w-[min(60vw,900px)] data-[vaul-drawer-direction=right]:sm:max-w-none max-h-screen overflow-hidden',
        )}
      >
        <DrawerHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
          <div>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{subtitle}</DrawerDescription>
          </div>
          <div className="flex items-center gap-2">
            {openTo ? (
              <Button size="icon-sm" variant="outline" asChild>
                <Link
                  to={openTo}
                  onClick={() => onOpenChange(false)}
                  aria-label="Open full view"
                  title="Open full view"
                >
                  <IconExternalLink className="size-4" />
                </Link>
              </Button>
            ) : null}
            <DrawerClose asChild>
              <Button size="icon" variant="ghost" aria-label="Close drawer">
                <IconX className="size-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    {subtitle ? (
                      <p className="text-xs text-muted-foreground">
                        {subtitle}
                      </p>
                    ) : null}
                  </div>
                  {status ? <StatusPill status={status} /> : null}
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  {stage ? (
                    <p>
                      <span className="text-muted-foreground">Stage:</span>{' '}
                      {stage}
                    </p>
                  ) : null}
                  {nextStep ? (
                    <p>
                      <span className="text-muted-foreground">Next:</span>{' '}
                      {nextStep}
                    </p>
                  ) : null}
                  {confidence ? (
                    <p>
                      <span className="text-muted-foreground">Confidence:</span>{' '}
                      {confidence}
                    </p>
                  ) : null}
                  {atc ? (
                    <p>
                      <span className="text-muted-foreground">ATC:</span> {atc}
                    </p>
                  ) : null}
                  {payee ? (
                    <p>
                      <span className="text-muted-foreground">Payee:</span>{' '}
                      {payee}
                    </p>
                  ) : null}
                </div>
                {meta?.length ? (
                  <div className="mt-4 grid gap-2 text-sm">
                    {meta.map((item) => (
                      <p key={`${item.label}-${item.value}`}>
                        <span className="text-muted-foreground">
                          {item.label}:
                        </span>{' '}
                        {item.value}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  Processing status
                </p>
                <div className="mt-3 space-y-2 text-sm">
                  <p>
                    <span className="text-muted-foreground">Started:</span>{' '}
                    {processing?.startedAt ?? '—'}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Last update:</span>{' '}
                    {processing?.updatedAt ?? '—'}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Worker:</span>{' '}
                    {processing?.worker ?? '—'}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Elapsed:</span>{' '}
                    {processing?.elapsed ?? '—'}
                  </p>
                </div>
              </div>

              {trail?.length ? (
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Pipeline trail
                  </p>
                  <div className="mt-3 grid gap-2">
                    {trail.map((step) => (
                      <div
                        key={step.label}
                        className={cn(
                          'rounded-2xl border p-3 text-sm',
                          trailStyles[step.status],
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium">{step.label}</p>
                          <Badge
                            variant="outline"
                            className={cn(
                              'h-5 px-2 text-[10px] uppercase',
                              trailStyles[step.status],
                            )}
                          >
                            {step.status}
                          </Badge>
                        </div>
                        {step.detail ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {step.detail}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  Errors
                </p>
                {errors?.length ? (
                  <div className="mt-3 space-y-2 text-sm">
                    {errors.map((error) => (
                      <div
                        key={`${error.code}-${error.stage}`}
                        className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3"
                      >
                        <p className="text-xs text-rose-700">
                          {error.code} · {error.stage}
                        </p>
                        <p className="mt-1">{error.message}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No errors flagged for this file.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Event logs</p>
                <Badge variant="outline" className="text-xs">
                  {logs?.length ?? 0} entries
                </Badge>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/40">
                {logs?.length ? (
                  logs.map((log, index) => (
                    <div
                      key={`${log.timestamp}-${index}`}
                      className="flex flex-wrap items-start gap-3 border-b border-border/40 p-3 text-sm last:border-b-0"
                    >
                      <span className="text-xs text-muted-foreground">
                        {log.timestamp}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-5 px-2 text-[10px] uppercase',
                          logLevelStyles[log.level],
                        )}
                      >
                        {log.level}
                      </Badge>
                      <p className="flex-1">{log.message}</p>
                    </div>
                  ))
                ) : (
                  <p className="p-3 text-sm text-muted-foreground">
                    No logs captured yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
