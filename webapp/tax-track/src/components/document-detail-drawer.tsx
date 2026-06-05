import {
  IconChevronDown,
  IconExternalLink,
  IconListCheck,
  IconX,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'

import type { DocumentReviewFieldView } from '@/lib/documents-types'
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

type DocumentMetaItem = {
  label: string
  value: string
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
  meta?: Array<DocumentMetaItem>
  processing?: DocumentProcessing
  trail?: Array<DocumentTrailStep>
  logs?: Array<DocumentLog>
  errors?: Array<DocumentError>
  reviewFields?: Array<DocumentReviewFieldView>
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

const SIGNATURE_TEXT_REVIEW_FIELD_KEY = 'signatureText'
const SIGNATURE_TEXT_REVIEW_FIELD_LABEL = 'signature text'

export const getDrawerReviewFields = (
  fields: Array<DocumentReviewFieldView> = [],
) =>
  fields.filter(
    (field) =>
      field.key !== SIGNATURE_TEXT_REVIEW_FIELD_KEY &&
      field.label.trim().toLowerCase() !== SIGNATURE_TEXT_REVIEW_FIELD_LABEL,
  )

const getVisibleMetaItems = (items: Array<DocumentMetaItem>) =>
  items.filter((item) => item.value.trim() && item.value !== '—')

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
  reviewFields,
  openTo,
}: DocumentDetailDrawerProps) {
  const extractedFields = getDrawerReviewFields(reviewFields)
  const summaryItems = getVisibleMetaItems([
    { label: 'Payee', value: payee ?? '' },
    { label: 'ATC', value: atc ?? '' },
    { label: 'Confidence', value: confidence ?? '' },
    { label: 'Stage', value: stage ?? '' },
  ])
  const validationMeta = getVisibleMetaItems(meta ?? [])
  const hasValidationSection =
    validationMeta.length > 0 || Boolean(errors?.length)

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent
        className={cn(
          'data-[vaul-drawer-direction=right]:w-[min(94vw,760px)] data-[vaul-drawer-direction=right]:sm:max-w-none max-h-screen overflow-hidden',
        )}
      >
        <DrawerHeader className="border-b border-border/60 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DrawerTitle className="truncate text-base">
                  {title}
                </DrawerTitle>
                {status ? <StatusPill status={status} /> : null}
              </div>
              {subtitle ? (
                <DrawerDescription className="mt-1 text-xs">
                  {subtitle}
                </DrawerDescription>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
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
          </div>
          {summaryItems.length || nextStep ? (
            <div className="mt-4 flex flex-col gap-2 border-t border-border/50 pt-3">
              {summaryItems.length ? (
                <dl className="grid gap-2 sm:grid-cols-4">
                  {summaryItems.map((item) => (
                    <SummaryMetric key={item.label} item={item} />
                  ))}
                </dl>
              ) : null}
              {nextStep ? (
                <p className="truncate text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Next:</span>{' '}
                  {nextStep}
                </p>
              ) : null}
            </div>
          ) : null}
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-4">
            <ExtractedFieldsTable fields={extractedFields} />

            {hasValidationSection ? (
              <ValidationSection meta={validationMeta} errors={errors ?? []} />
            ) : null}

            <div className="flex flex-col gap-2">
              <DisclosureSection title="Processing">
                <ProcessingDetails processing={processing} />
              </DisclosureSection>

              {trail?.length ? (
                <DisclosureSection
                  title="Pipeline trail"
                  badge={`${trail.length} steps`}
                >
                  <PipelineTrail steps={trail} />
                </DisclosureSection>
              ) : null}

              <DisclosureSection
                title="Event logs"
                badge={`${logs?.length ?? 0} entries`}
              >
                <EventLogs logs={logs ?? []} />
              </DisclosureSection>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function SummaryMetric({ item }: { item: DocumentMetaItem }) {
  return (
    <div className="min-w-0 rounded-md border border-border/50 bg-muted/30 px-2.5 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {item.label}
      </dt>
      <dd className="mt-0.5 truncate text-xs font-semibold">{item.value}</dd>
    </div>
  )
}

function SectionHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <IconListCheck className="size-3.5" />
        {title}
      </p>
      {badge ? (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
          {badge}
        </Badge>
      ) : null}
    </div>
  )
}

function ExtractedFieldsTable({
  fields,
}: {
  fields: Array<DocumentReviewFieldView>
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        title="Extracted fields"
        badge={`${fields.length} ${fields.length === 1 ? 'field' : 'fields'}`}
      />
      {fields.length ? (
        <dl className="overflow-hidden rounded-lg border border-border/60 bg-background">
          <div className="hidden grid-cols-[minmax(8rem,0.8fr)_minmax(0,1fr)_5.5rem] border-b border-border/60 bg-muted/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Field</span>
            <span>Value</span>
            <span className="text-right">Confidence</span>
          </div>
          {fields.map((field, index) => (
            <div
              key={`${field.key ?? field.label}-${index}`}
              className="grid gap-1 border-b border-border/40 px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(0,1fr)_5.5rem] sm:items-start"
            >
              <dt className="font-medium text-muted-foreground">
                {field.label}
              </dt>
              <dd className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="break-words font-semibold">
                    {field.value || '—'}
                  </span>
                  {field.source === 'edited' ? (
                    <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                      Edited
                    </Badge>
                  ) : null}
                </div>
                {field.source === 'edited' && field.originalValue ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Original: {field.originalValue}
                  </p>
                ) : null}
              </dd>
              <dd className="text-[11px] font-medium text-muted-foreground sm:text-right">
                <span className="sm:hidden">Confidence </span>
                {field.confidence}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          No extracted field data available.
        </p>
      )}
    </section>
  )
}

function ValidationSection({
  meta,
  errors,
}: {
  meta: Array<DocumentMetaItem>
  errors: Array<DocumentError>
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Issue and validation" />
      <div className="rounded-lg border border-border/60 bg-muted/25">
        {meta.length ? (
          <dl className="grid gap-x-4 gap-y-2 border-b border-border/50 px-3 py-2 text-xs sm:grid-cols-2">
            {meta.map((item, index) => (
              <div key={`${item.label}-${index}`} className="min-w-0">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="mt-0.5 break-words font-medium">{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {errors.length ? (
          <div className="flex flex-col gap-2 p-3">
            {errors.map((error) => (
              <div
                key={`${error.code}-${error.stage}`}
                className="rounded-md border border-rose-500/20 bg-rose-500/10 px-2.5 py-2 text-xs"
              >
                <p className="font-medium text-rose-700">
                  {error.code} · {error.stage}
                </p>
                <p className="mt-0.5">{error.message}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function DisclosureSection({
  title,
  badge,
  children,
}: {
  title: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <details className="group rounded-lg border border-border/60 bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold marker:hidden">
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {badge ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {badge}
            </Badge>
          ) : null}
          <IconChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-border/50 p-3">{children}</div>
    </details>
  )
}

function ProcessingDetails({
  processing,
}: {
  processing?: DocumentProcessing
}) {
  const items = [
    { label: 'Started', value: processing?.startedAt ?? '—' },
    { label: 'Last update', value: processing?.updatedAt ?? '—' },
    { label: 'Worker', value: processing?.worker ?? '—' },
    { label: 'Elapsed', value: processing?.elapsed ?? '—' },
  ]

  return (
    <dl className="grid gap-2 text-xs sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 break-words font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function PipelineTrail({ steps }: { steps: Array<DocumentTrailStep> }) {
  return (
    <div className="flex flex-col gap-2">
      {steps.map((step) => (
        <div
          key={step.label}
          className={cn(
            'rounded-md border px-2.5 py-2 text-xs',
            trailStyles[step.status],
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">{step.label}</p>
            <Badge
              variant="outline"
              className={cn(
                'h-5 px-1.5 text-[10px] uppercase',
                trailStyles[step.status],
              )}
            >
              {step.status}
            </Badge>
          </div>
          {step.detail ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {step.detail}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function EventLogs({ logs }: { logs: Array<DocumentLog> }) {
  if (!logs.length) {
    return (
      <p className="text-xs text-muted-foreground">No logs captured yet.</p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {logs.map((log, index) => (
        <div
          key={`${log.timestamp}-${index}`}
          className="grid gap-1 rounded-md border border-border/50 bg-background px-2.5 py-2 text-xs sm:grid-cols-[7rem_4.5rem_minmax(0,1fr)] sm:items-start"
        >
          <span className="text-muted-foreground">{log.timestamp}</span>
          <Badge
            variant="outline"
            className={cn(
              'h-5 w-fit px-1.5 text-[10px] uppercase',
              logLevelStyles[log.level],
            )}
          >
            {log.level}
          </Badge>
          <p className="break-words">{log.message}</p>
        </div>
      ))}
    </div>
  )
}
