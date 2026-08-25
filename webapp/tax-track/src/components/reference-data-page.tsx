import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
  Delete02Icon,
  Edit02Icon,
  FilterResetIcon,
  Loading03Icon,
  RefreshIcon,
  Search01Icon,
  Upload01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { FormEvent, ReactNode } from 'react'

import type {
  AtcCodeReferenceRow,
  EntityReferenceRow,
  MasterlistReferenceRow,
  ReferenceDataDataset,
  ReferenceDataFacets,
  ReferenceDataRow,
  ReferenceDataSummary,
} from '@/lib/reference-data'
import type {
  ReferenceDataRouteSearch,
  ReferenceDataSortKey,
} from '@/lib/reference-data-search-state'

import { AppShell } from '@/components/app-shell'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import {
  REFERENCE_DATA_PAGE_SIZE_OPTIONS,
  buildReferenceDataQueryParams,
  getActiveReferenceDataFilterCount,
  parseReferenceDataSearch,
  switchReferenceDataDataset,
} from '@/lib/reference-data-search-state'
import {
  preserveScrollDuringNavigation,
  useDebouncedRouteSearchInput,
} from '@/hooks/use-preserved-route-search'
import { isSuperAdmin, parseSessionContext } from '@/lib/access-control'
import {
  REFERENCE_DATA_MAX_FILE_BYTES,
  atcCodeRowInputSchema,
  entityRowInputSchema,
  masterlistRowInputSchema,
  referenceDataDatasets,
  referenceDataDefinitions,
} from '@/lib/reference-data'

type ReferenceDataListResponse = {
  dataset: ReferenceDataDataset
  rows: Array<ReferenceDataRow>
  total: number
  page: number
  pageSize: number
  totalPages: number
  facets: ReferenceDataFacets
  error?: string
}

type RowEditorState = {
  open: boolean
  row: ReferenceDataRow | null
  key: number
}

type DraftValue = string | boolean
type RowDraft = Record<string, DraftValue>
type RowFieldErrors = Record<string, string>

type FieldDefinition = {
  key: string
  label: string
  input?: 'text' | 'email' | 'textarea'
  placeholder?: string
}

const initialResults: Record<
  ReferenceDataDataset,
  ReferenceDataListResponse | null
> = {
  masterlist: null,
  entities: null,
  'atc-codes': null,
}

const fieldDefinitions: Record<
  ReferenceDataDataset,
  ReadonlyArray<FieldDefinition>
> = {
  masterlist: [
    { key: 'region', label: 'Region' },
    { key: 'entity', label: 'Entity' },
    { key: 'shortName', label: 'Short name' },
    { key: 'customerName', label: 'Customer name' },
    { key: 'tin', label: 'TIN' },
    { key: 'address', label: 'Address', input: 'textarea' },
    { key: 'emailAddress', label: 'Email address', input: 'email' },
  ],
  entities: [
    { key: 'shortName', label: 'Short name' },
    { key: 'companyName', label: 'Company name' },
    {
      key: 'birRegisteredAddress',
      label: 'BIR registered address',
      input: 'textarea',
    },
    { key: 'zipCode', label: 'ZIP code' },
    { key: 'tin', label: 'TIN' },
    { key: 'emailAddress', label: 'Email address', input: 'email' },
    {
      key: 'regionEmailAddress',
      label: 'Region email address',
      input: 'email',
    },
  ],
  'atc-codes': [
    { key: 'taxType', label: 'Tax type' },
    { key: 'code', label: 'ATC code' },
    { key: 'description', label: 'Description', input: 'textarea' },
    { key: 'ratePercent', label: 'Tax rate (%)', placeholder: '2' },
  ],
}

const buildDraft = (
  dataset: ReferenceDataDataset,
  row: ReferenceDataRow | null,
): RowDraft => {
  if (dataset === 'masterlist') {
    const value = row as MasterlistReferenceRow | null
    return {
      region: value?.region ?? '',
      entity: value?.entity ?? '',
      shortName: value?.shortName ?? '',
      customerName: value?.customerName ?? '',
      tin: value?.tin ?? '',
      address: value?.address ?? '',
      emailAddress: value?.emailAddress ?? '',
      isGovernment: value?.isGovernment ?? false,
    }
  }

  if (dataset === 'entities') {
    const value = row as EntityReferenceRow | null
    return {
      shortName: value?.shortName ?? '',
      companyName: value?.companyName ?? '',
      birRegisteredAddress: value?.birRegisteredAddress ?? '',
      zipCode: value?.zipCode ?? '',
      tin: value?.tin ?? '',
      emailAddress: value?.emailAddress ?? '',
      regionEmailAddress: value?.regionEmailAddress ?? '',
    }
  }

  const value = row as AtcCodeReferenceRow | null
  return {
    taxType: value?.taxType ?? '',
    code: value?.code ?? '',
    description: value?.description ?? '',
    ratePercent: value ? String(value.rate * 100) : '',
  }
}

const buildPayload = (dataset: ReferenceDataDataset, draft: RowDraft) => {
  if (dataset === 'masterlist') {
    return masterlistRowInputSchema.safeParse({
      region: draft.region,
      entity: draft.entity,
      shortName: draft.shortName,
      customerName: draft.customerName,
      tin: draft.tin,
      address: draft.address,
      emailAddress: draft.emailAddress,
      isGovernment: draft.isGovernment === true,
    })
  }

  if (dataset === 'entities') {
    return entityRowInputSchema.safeParse({
      shortName: draft.shortName,
      companyName: draft.companyName,
      birRegisteredAddress: draft.birRegisteredAddress,
      zipCode: draft.zipCode,
      tin: draft.tin,
      emailAddress: draft.emailAddress,
      regionEmailAddress: draft.regionEmailAddress,
    })
  }

  const ratePercent = Number(draft.ratePercent)
  return atcCodeRowInputSchema.safeParse({
    taxType: draft.taxType,
    code: draft.code,
    description: draft.description,
    rate: ratePercent / 100,
  })
}

const readJson = async <T,>(response: Response): Promise<T> =>
  (await response.json().catch(() => ({}))) as T

const getApiError = async (response: Response, fallback: string) => {
  const payload = await readJson<{ error?: string }>(response)
  return payload.error || fallback
}

function ReferenceDataRowSheet({
  dataset,
  editor,
  onOpenChange,
  onSaved,
}: {
  dataset: ReferenceDataDataset
  editor: RowEditorState
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void> | void
}) {
  const [draft, setDraft] = useState<RowDraft>(() =>
    buildDraft(dataset, editor.row),
  )
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<RowFieldErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const definition = referenceDataDefinitions[dataset]
  const isEditing = Boolean(editor.row)

  const updateField = (key: string, value: DraftValue) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setFieldErrors({})

    const parsed = buildPayload(dataset, draft)
    if (!parsed.success) {
      const nextFieldErrors: RowFieldErrors = {}
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '')
        if (field && !nextFieldErrors[field]) {
          nextFieldErrors[field] = issue.message
        }
      }
      setFieldErrors(nextFieldErrors)
      if (Object.keys(nextFieldErrors).length === 0) {
        setError(parsed.error.issues[0]?.message ?? 'Invalid row values.')
      }
      return
    }

    setIsSaving(true)
    try {
      const endpoint = editor.row
        ? `/api/reference-data/${dataset}/${editor.row.id}`
        : `/api/reference-data/${dataset}`
      const response = await fetch(endpoint, {
        method: editor.row ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })

      if (!response.ok) {
        throw new Error(await getApiError(response, 'Unable to save row.'))
      }

      toast.success(isEditing ? 'Reference row updated' : 'Reference row added')
      onOpenChange(false)
      await onSaved()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Unable to save row.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={editor.open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {isEditing
              ? `Edit ${definition.singularLabel}`
              : `Add ${definition.singularLabel}`}
          </SheetTitle>
          <SheetDescription>
            Changes apply immediately to future processing and lookups.
          </SheetDescription>
        </SheetHeader>
        <form
          noValidate
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <FieldGroup>
              {error ? <FieldError>{error}</FieldError> : null}
              {fieldDefinitions[dataset].map((field) => (
                <Field
                  key={field.key}
                  data-invalid={Boolean(fieldErrors[field.key])}
                >
                  <FieldLabel htmlFor={`reference-row-${field.key}`}>
                    {field.label}
                  </FieldLabel>
                  {field.input === 'textarea' ? (
                    <Textarea
                      id={`reference-row-${field.key}`}
                      value={String(draft[field.key] ?? '')}
                      aria-invalid={Boolean(fieldErrors[field.key])}
                      onChange={(event) =>
                        updateField(field.key, event.target.value)
                      }
                      disabled={isSaving}
                    />
                  ) : (
                    <Input
                      id={`reference-row-${field.key}`}
                      type={field.input ?? 'text'}
                      inputMode={
                        field.key === 'ratePercent' ? 'decimal' : undefined
                      }
                      placeholder={field.placeholder}
                      value={String(draft[field.key] ?? '')}
                      aria-invalid={Boolean(fieldErrors[field.key])}
                      onChange={(event) =>
                        updateField(field.key, event.target.value)
                      }
                      disabled={isSaving}
                    />
                  )}
                  {fieldErrors[field.key] ? (
                    <FieldError>{fieldErrors[field.key]}</FieldError>
                  ) : null}
                </Field>
              ))}
              {dataset === 'masterlist' ? (
                <Field orientation="horizontal">
                  <Checkbox
                    id="reference-row-government"
                    checked={draft.isGovernment === true}
                    onCheckedChange={(value) =>
                      updateField('isGovernment', value === true)
                    }
                    disabled={isSaving}
                  />
                  <FieldLabel htmlFor="reference-row-government">
                    Government customer
                  </FieldLabel>
                </Field>
              ) : null}
            </FieldGroup>
          </div>
          <Separator />
          <SheetFooter>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Add row'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function ReferenceDataImportSheet({
  dataset,
  open,
  onOpenChange,
  onImported,
}: {
  dataset: ReferenceDataDataset
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void> | void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const definition = referenceDataDefinitions[dataset]

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen && !isImporting) {
      setFile(null)
      setError('')
      setIsConfirmOpen(false)
    }
  }

  const prepareImport = () => {
    setError('')
    if (!file) {
      setError('Choose a CSV file first.')
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Only CSV files are supported.')
      return
    }
    if (file.size > REFERENCE_DATA_MAX_FILE_BYTES) {
      setError('CSV files may not exceed 10 MiB.')
      return
    }
    setIsConfirmOpen(true)
  }

  const importFile = async () => {
    if (!file) {
      return
    }

    setIsImporting(true)
    setError('')
    try {
      const formData = new FormData()
      formData.set('file', file)
      const response = await fetch(definition.importUrl, {
        method: 'POST',
        body: formData,
      })
      const payload = await readJson<{
        insertedCount?: number
        error?: string
      }>(response)
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to import CSV file.')
      }

      toast.success(`${definition.label} replaced`, {
        description: `${(payload.insertedCount ?? 0).toLocaleString()} rows imported from ${file.name}.`,
      })
      setIsConfirmOpen(false)
      setFile(null)
      setError('')
      onOpenChange(false)
      await onImported()
    } catch (importError) {
      const message =
        importError instanceof Error
          ? importError.message
          : 'Unable to import CSV file.'
      setError(message)
      setIsConfirmOpen(false)
      toast.error('CSV import failed', { description: message })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Import {definition.label}</SheetTitle>
            <SheetDescription>
              Upload a validated CSV to replace this reference dataset.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">
            <Alert>
              <AlertTitle>Required CSV headers</AlertTitle>
              <AlertDescription>
                {definition.headers.join(', ')}
                {dataset === 'masterlist'
                  ? '. Optional header: Government (Y or N)'
                  : null}
              </AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>This replaces existing data</AlertTitle>
              <AlertDescription>
                The file is validated before any changes are committed. Entity
                IDs are preserved by exact normalized TIN matches, and
                referenced entities cannot be omitted.
              </AlertDescription>
            </Alert>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="reference-data-file">CSV file</FieldLabel>
              <Input
                id="reference-data-file"
                type="file"
                accept=".csv,text/csv"
                aria-invalid={Boolean(error)}
                disabled={isImporting}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  setError('')
                }}
              />
              <FieldDescription>Maximum file size: 10 MiB.</FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </div>
          <Separator />
          <SheetFooter>
            <Button
              type="button"
              onClick={prepareImport}
              disabled={isImporting}
            >
              Review replacement
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isImporting}
            >
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace {definition.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the dataset with the rows from {file?.name}. The
              operation is atomic and cannot be undone from this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isImporting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isImporting}
              onClick={(event) => {
                event.preventDefault()
                void importFile()
              }}
            >
              {isImporting ? 'Replacing…' : 'Replace data'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function LoadingRows({ columnCount }: { columnCount: number }) {
  return Array.from({ length: 6 }, (_rowValue, index) => (
    <TableRow key={index}>
      {Array.from({ length: columnCount }, (_cellValue, cellIndex) => (
        <TableCell key={cellIndex}>
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ))
}

const displayValue = (value: string | null) => value || '—'

function IconActionTooltip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function RowActions({
  row,
  onEdit,
  onDelete,
}: {
  row: ReferenceDataRow
  onEdit: (row: ReferenceDataRow) => void
  onDelete: (row: ReferenceDataRow) => void
}) {
  return (
    <div className="flex justify-end gap-1">
      <IconActionTooltip label="Edit row">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Edit row"
          onClick={() => onEdit(row)}
        >
          <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
        </Button>
      </IconActionTooltip>
      <IconActionTooltip label="Delete row">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Delete row"
          onClick={() => onDelete(row)}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
      </IconActionTooltip>
    </div>
  )
}

function TruncatedValue({
  value,
  className,
}: {
  value: string | null
  className?: string
}) {
  const display = displayValue(value)
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={cn('block truncate', className)} />}
      >
        {display}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-words">
        {display}
      </TooltipContent>
    </Tooltip>
  )
}

function SortableTableHead({
  label,
  sortKey,
  currentSort,
  direction,
  onSort,
  className,
}: {
  label: string
  sortKey: ReferenceDataSortKey
  currentSort: ReferenceDataSortKey
  direction: ReferenceDataRouteSearch['direction']
  onSort: (sort: ReferenceDataSortKey) => void
  className?: string
}) {
  const isActive = currentSort === sortKey
  const icon = isActive
    ? direction === 'asc'
      ? ArrowUp01Icon
      : ArrowDown01Icon
    : ArrowUpDownIcon

  return (
    <TableHead
      aria-sort={
        isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      className={cn('sticky top-0 bg-muted/35', className)}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="-ml-2"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <HugeiconsIcon icon={icon} data-icon="inline-end" strokeWidth={2} />
      </Button>
    </TableHead>
  )
}

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
})

const COMPACT_TABLE_CLASS =
  'text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2'

const searchPlaceholderByDataset: Record<ReferenceDataDataset, string> = {
  masterlist: 'Search customer, TIN, short name, or email…',
  entities: 'Search company, TIN, short name, or email…',
  'atc-codes': 'Search ATC code, tax type, or description…',
}

function EmptyTableRows({
  colSpan,
  datasetLabel,
  hasActiveQuery,
  onClear,
  onAdd,
}: {
  colSpan: number
  datasetLabel: string
  hasActiveQuery: boolean
  onClear: () => void
  onAdd: () => void
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="p-0">
        <Empty className="min-h-52 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>
              {hasActiveQuery ? 'No matching rows' : `No ${datasetLabel}`}
            </EmptyTitle>
            <EmptyDescription>
              {hasActiveQuery
                ? 'Try clearing the search or filters to see more results.'
                : 'Add the first row or import a CSV file to get started.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              size="sm"
              variant={hasActiveQuery ? 'outline' : 'default'}
              onClick={hasActiveQuery ? onClear : onAdd}
            >
              {hasActiveQuery ? (
                <HugeiconsIcon
                  icon={FilterResetIcon}
                  data-icon="inline-start"
                  strokeWidth={2}
                />
              ) : (
                <HugeiconsIcon
                  icon={Add01Icon}
                  data-icon="inline-start"
                  strokeWidth={2}
                />
              )}
              {hasActiveQuery ? 'Clear search and filters' : 'Add row'}
            </Button>
          </EmptyContent>
        </Empty>
      </TableCell>
    </TableRow>
  )
}

type DatasetTableProps = {
  dataset: ReferenceDataDataset
  result: ReferenceDataListResponse | null
  isInitialLoading: boolean
  search: ReferenceDataRouteSearch
  hasActiveQuery: boolean
  onEdit: (row: ReferenceDataRow) => void
  onDelete: (row: ReferenceDataRow) => void
  onSort: (sort: ReferenceDataSortKey) => void
  onClear: () => void
  onAdd: () => void
}

function DatasetTable({
  dataset,
  result,
  isInitialLoading,
  search,
  hasActiveQuery,
  onEdit,
  onDelete,
  onSort,
  onClear,
  onAdd,
}: DatasetTableProps) {
  if (dataset === 'masterlist') {
    const rows = (result?.rows ?? []) as Array<MasterlistReferenceRow>
    return (
      <Table className={cn('min-w-[1100px]', COMPACT_TABLE_CLASS)}>
        <TableHeader className="[&_tr]:border-border/60">
          <TableRow className="bg-muted/35 hover:bg-muted/35">
            <SortableTableHead
              label="Customer"
              sortKey="customerName"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
              className="left-0"
            />
            <SortableTableHead
              label="TIN"
              sortKey="tin"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <SortableTableHead
              label="Short name"
              sortKey="shortName"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <SortableTableHead
              label="Entity"
              sortKey="entity"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <SortableTableHead
              label="Region"
              sortKey="region"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <SortableTableHead
              label="Email"
              sortKey="emailAddress"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <SortableTableHead
              label="Government"
              sortKey="isGovernment"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <TableHead className="sticky top-0 right-0 w-20 bg-muted/35 text-right">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-b-0">
          {isInitialLoading ? <LoadingRows columnCount={8} /> : null}
          {!isInitialLoading && rows.length === 0 ? (
            <EmptyTableRows
              colSpan={8}
              datasetLabel="masterlist rows"
              hasActiveQuery={hasActiveQuery}
              onClear={onClear}
              onAdd={onAdd}
            />
          ) : null}
          {!isInitialLoading
            ? rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group border-border/60 bg-background hover:bg-muted/35"
                >
                  <TableCell className="sticky left-0 max-w-64 bg-background font-medium group-hover:bg-muted/35">
                    <TruncatedValue
                      value={row.customerName}
                      className="max-w-64"
                    />
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {displayValue(row.tin)}
                  </TableCell>
                  <TableCell>{displayValue(row.shortName)}</TableCell>
                  <TableCell>{displayValue(row.entity)}</TableCell>
                  <TableCell>{displayValue(row.region)}</TableCell>
                  <TableCell>
                    <TruncatedValue
                      value={row.emailAddress}
                      className="max-w-56"
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {row.isGovernment ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell className="sticky right-0 bg-background group-hover:bg-muted/35">
                    <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
                  </TableCell>
                </TableRow>
              ))
            : null}
        </TableBody>
      </Table>
    )
  }

  if (dataset === 'entities') {
    const rows = (result?.rows ?? []) as Array<EntityReferenceRow>
    return (
      <Table className={cn('min-w-[1050px]', COMPACT_TABLE_CLASS)}>
        <TableHeader className="[&_tr]:border-border/60">
          <TableRow className="bg-muted/35 hover:bg-muted/35">
            <SortableTableHead
              label="Short name"
              sortKey="shortName"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
              className="left-0"
            />
            <SortableTableHead
              label="Company"
              sortKey="companyName"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <SortableTableHead
              label="TIN"
              sortKey="tin"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <SortableTableHead
              label="ZIP code"
              sortKey="zipCode"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <SortableTableHead
              label="Email"
              sortKey="emailAddress"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <SortableTableHead
              label="Region email"
              sortKey="regionEmailAddress"
              currentSort={search.sort}
              direction={search.direction}
              onSort={onSort}
            />
            <TableHead className="sticky top-0 right-0 w-20 bg-muted/35 text-right">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-b-0">
          {isInitialLoading ? <LoadingRows columnCount={7} /> : null}
          {!isInitialLoading && rows.length === 0 ? (
            <EmptyTableRows
              colSpan={7}
              datasetLabel="entities"
              hasActiveQuery={hasActiveQuery}
              onClear={onClear}
              onAdd={onAdd}
            />
          ) : null}
          {!isInitialLoading
            ? rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group border-border/60 bg-background hover:bg-muted/35"
                >
                  <TableCell className="sticky left-0 bg-background font-medium group-hover:bg-muted/35">
                    {displayValue(row.shortName)}
                  </TableCell>
                  <TableCell>
                    <TruncatedValue
                      value={row.companyName}
                      className="max-w-72"
                    />
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {displayValue(row.tin)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {displayValue(row.zipCode)}
                  </TableCell>
                  <TableCell>
                    <TruncatedValue
                      value={row.emailAddress}
                      className="max-w-56"
                    />
                  </TableCell>
                  <TableCell>
                    <TruncatedValue
                      value={row.regionEmailAddress}
                      className="max-w-56"
                    />
                  </TableCell>
                  <TableCell className="sticky right-0 bg-background group-hover:bg-muted/35">
                    <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
                  </TableCell>
                </TableRow>
              ))
            : null}
        </TableBody>
      </Table>
    )
  }

  const rows = (result?.rows ?? []) as Array<AtcCodeReferenceRow>
  return (
    <Table className={cn('min-w-[760px]', COMPACT_TABLE_CLASS)}>
      <TableHeader className="[&_tr]:border-border/60">
        <TableRow className="bg-muted/35 hover:bg-muted/35">
          <SortableTableHead
            label="ATC"
            sortKey="code"
            currentSort={search.sort}
            direction={search.direction}
            onSort={onSort}
            className="left-0"
          />
          <SortableTableHead
            label="Tax type"
            sortKey="taxType"
            currentSort={search.sort}
            direction={search.direction}
            onSort={onSort}
          />
          <SortableTableHead
            label="Description"
            sortKey="description"
            currentSort={search.sort}
            direction={search.direction}
            onSort={onSort}
          />
          <SortableTableHead
            label="Rate"
            sortKey="rate"
            currentSort={search.sort}
            direction={search.direction}
            onSort={onSort}
            className="text-right"
          />
          <TableHead className="sticky top-0 right-0 w-20 bg-muted/35 text-right">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="[&_tr:last-child]:border-b-0">
        {isInitialLoading ? <LoadingRows columnCount={5} /> : null}
        {!isInitialLoading && rows.length === 0 ? (
          <EmptyTableRows
            colSpan={5}
            datasetLabel="ATC codes"
            hasActiveQuery={hasActiveQuery}
            onClear={onClear}
            onAdd={onAdd}
          />
        ) : null}
        {!isInitialLoading
          ? rows.map((row) => (
              <TableRow
                key={row.id}
                className="group border-border/60 bg-background hover:bg-muted/35"
              >
                <TableCell className="sticky left-0 bg-background font-mono font-medium group-hover:bg-muted/35">
                  {row.code}
                </TableCell>
                <TableCell>{row.taxType}</TableCell>
                <TableCell>
                  <TruncatedValue
                    value={row.description}
                    className="max-w-xl"
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {percentFormatter.format(row.rate)}
                </TableCell>
                <TableCell className="sticky right-0 bg-background group-hover:bg-muted/35">
                  <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
                </TableCell>
              </TableRow>
            ))
          : null}
      </TableBody>
    </Table>
  )
}

const getDeleteRowLabel = (
  dataset: ReferenceDataDataset,
  row: ReferenceDataRow | null,
) => {
  if (!row) return 'this row'
  if (dataset === 'masterlist') {
    const masterlistRow = row as MasterlistReferenceRow
    return (
      masterlistRow.customerName ||
      masterlistRow.shortName ||
      masterlistRow.tin ||
      `masterlist row ${row.id}`
    )
  }
  if (dataset === 'entities') {
    const entityRow = row as EntityReferenceRow
    return (
      entityRow.shortName ||
      entityRow.companyName ||
      entityRow.tin ||
      `entity ${row.id}`
    )
  }
  return (row as AtcCodeReferenceRow).code || `ATC code ${row.id}`
}

const getDeleteDescription = (dataset: ReferenceDataDataset) => {
  if (dataset === 'entities') {
    return 'This action cannot be undone. The deletion will be blocked if this entity is used by an upload batch or sales report.'
  }
  if (dataset === 'masterlist') {
    return 'This action cannot be undone. The customer will no longer be available for future masterlist matching.'
  }
  return 'This action cannot be undone. The code will no longer be available for future ATC lookups and processing.'
}

export function ReferenceDataPage({
  search,
}: {
  search: ReferenceDataRouteSearch
}) {
  const navigate = useNavigate({ from: '/reference-data' })
  const { data: session, isPending } = authClient.useSession()
  const [results, setResults] = useState(initialResults)
  const [summary, setSummary] = useState<ReferenceDataSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [editor, setEditor] = useState<RowEditorState>({
    open: false,
    row: null,
    key: 0,
  })
  const [deleteRow, setDeleteRow] = useState<ReferenceDataRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const context = session?.user ? parseSessionContext(session.user) : null
  const canManageReferenceData = context ? isSuperAdmin(context.role) : false
  const activeDataset = search.dataset
  const result = results[activeDataset]
  const definition = referenceDataDefinitions[activeDataset]
  const filterCount = getActiveReferenceDataFilterCount(search)
  const hasActiveQuery = Boolean(search.q || filterCount > 0)
  const hasHiddenFilters =
    activeDataset === 'masterlist'
      ? Boolean(search.region || search.entity)
      : activeDataset === 'entities'
        ? search.tinState !== 'all' || search.emailState !== 'all'
        : Boolean(search.taxType || search.rate)
  const queryString = useMemo(
    () => buildReferenceDataQueryParams(search).toString(),
    [search],
  )

  const updateSearch = useCallback(
    (
      patch: Partial<ReferenceDataRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      const nextSearch = parseReferenceDataSearch({
        ...search,
        ...patch,
        page: options.resetPage === false ? (patch.page ?? search.page) : 1,
      })
      void preserveScrollDuringNavigation(() =>
        navigate({
          search: nextSearch,
          replace: true,
          resetScroll: false,
        }),
      )
    },
    [navigate, search],
  )

  const {
    inputValue: searchInput,
    setInputValue: setSearchInput,
    commitInputValue: commitSearchInput,
  } = useDebouncedRouteSearchInput({
    value: search.q,
    onCommit: (value) => updateSearch({ q: value.trim() }),
  })

  useEffect(() => {
    if (!canManageReferenceData) return

    const controller = new AbortController()
    const load = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(
          `/api/reference-data/${activeDataset}?${queryString}`,
          { cache: 'no-store', signal: controller.signal },
        )
        if (!response.ok) {
          throw new Error(
            await getApiError(response, 'Unable to load reference data.'),
          )
        }
        const payload = await readJson<ReferenceDataListResponse>(response)
        if (controller.signal.aborted) return

        setResults((current) => ({ ...current, [activeDataset]: payload }))
        setLoadError('')
        if (payload.page !== search.page) {
          updateSearch({ page: payload.page }, { resetPage: false })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Unable to load reference data.',
          )
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [
    activeDataset,
    canManageReferenceData,
    queryString,
    refreshVersion,
    search.page,
    updateSearch,
  ])

  useEffect(() => {
    if (!canManageReferenceData) return

    const controller = new AbortController()
    const loadSummary = async () => {
      try {
        const response = await fetch('/api/reference-data/summary', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) return
        const payload = await readJson<{ totals?: ReferenceDataSummary }>(
          response,
        )
        if (!controller.signal.aborted && payload.totals) {
          setSummary(payload.totals)
        }
      } catch {
        // The active dataset still supplies its own count when summary fails.
      }
    }

    void loadSummary()
    return () => controller.abort()
  }, [canManageReferenceData, refreshVersion])

  const refresh = useCallback(() => {
    setRefreshVersion((current) => current + 1)
  }, [])

  const openCreate = useCallback(() => {
    setEditor((current) => ({ open: true, row: null, key: current.key + 1 }))
  }, [])

  const openEdit = useCallback((row: ReferenceDataRow) => {
    setEditor((current) => ({ open: true, row, key: current.key + 1 }))
  }, [])

  const clearFilters = useCallback(() => {
    updateSearch({
      region: '',
      entity: '',
      government: 'all',
      tinState: 'all',
      emailState: 'all',
      taxType: '',
      rate: '',
    })
  }, [updateSearch])

  const clearSearchAndFilters = useCallback(() => {
    commitSearchInput('', () =>
      updateSearch({
        q: '',
        region: '',
        entity: '',
        government: 'all',
        tinState: 'all',
        emailState: 'all',
        taxType: '',
        rate: '',
      }),
    )
  }, [commitSearchInput, updateSearch])

  const handleSort = useCallback(
    (sort: ReferenceDataSortKey) => {
      updateSearch({
        sort,
        direction:
          search.sort === sort && search.direction === 'asc' ? 'desc' : 'asc',
      })
    },
    [search.direction, search.sort, updateSearch],
  )

  const handleDelete = async () => {
    if (!deleteRow) return

    setIsDeleting(true)
    try {
      const response = await fetch(
        `/api/reference-data/${activeDataset}/${deleteRow.id}`,
        { method: 'DELETE' },
      )
      if (!response.ok) {
        throw new Error(await getApiError(response, 'Unable to delete row.'))
      }
      toast.success('Reference row deleted')
      setDeleteRow(null)
      refresh()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to delete row.'
      toast.error('Row was not deleted', { description: message })
    } finally {
      setIsDeleting(false)
    }
  }

  if (isPending) return null

  if (!canManageReferenceData) {
    return (
      <AppShell title="Reference Data" subtitle="Super admin only">
        <Alert variant="destructive">
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>
            Only the super admin can manage reference data.
          </AlertDescription>
        </Alert>
      </AppShell>
    )
  }

  const startRow =
    !result || result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1
  const endRow = !result
    ? 0
    : Math.min(result.page * result.pageSize, result.total)
  const currentPage = result?.page ?? search.page
  const totalPages = result?.totalPages ?? 1
  const deleteLabel = getDeleteRowLabel(activeDataset, deleteRow)

  return (
    <AppShell
      title="Reference Data"
      subtitle="Masterlist, entities, and ATC configuration"
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsImportOpen(true)}
        >
          <HugeiconsIcon
            icon={Upload01Icon}
            data-icon="inline-start"
            strokeWidth={2}
          />
          Import CSV
        </Button>
      }
    >
      <Tabs
        value={activeDataset}
        onValueChange={(value) => {
          if (referenceDataDatasets.includes(value as ReferenceDataDataset)) {
            setLoadError('')
            void navigate({
              search: switchReferenceDataDataset(
                search,
                value as ReferenceDataDataset,
              ),
              replace: true,
              resetScroll: false,
            })
          }
        }}
        className="min-h-0 flex-1"
      >
        <TabsList>
          {referenceDataDatasets.map((dataset) => (
            <TabsTrigger key={dataset} value={dataset}>
              {referenceDataDefinitions[dataset].label}
              <Badge variant="secondary">
                {summary ? summary[dataset].toLocaleString() : '—'}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeDataset} className="min-h-0">
          <Card
            size="sm"
            className="min-h-0 rounded-lg border-border/70 shadow-none ring-0"
          >
            <CardHeader>
              <CardTitle>{definition.label}</CardTitle>
              <CardDescription>
                {result
                  ? `${result.total.toLocaleString()} matching rows`
                  : 'Loading row count…'}
              </CardDescription>
              <CardAction>
                <Button size="sm" onClick={openCreate}>
                  <HugeiconsIcon
                    icon={Add01Icon}
                    data-icon="inline-start"
                    strokeWidth={2}
                  />
                  Add row
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <form
                  className="min-w-64 flex-1 md:max-w-md"
                  onSubmit={(event) => {
                    event.preventDefault()
                    commitSearchInput(searchInput.trim())
                  }}
                >
                  <Field>
                    <FieldLabel
                      htmlFor="reference-data-search"
                      className="sr-only"
                    >
                      Search {definition.label}
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupAddon align="inline-start">
                        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
                      </InputGroupAddon>
                      <InputGroupInput
                        id="reference-data-search"
                        type="search"
                        placeholder={searchPlaceholderByDataset[activeDataset]}
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                      />
                      {searchInput ? (
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            type="button"
                            aria-label="Clear search"
                            onClick={() =>
                              commitSearchInput('', () =>
                                updateSearch({ q: '' }),
                              )
                            }
                          >
                            <HugeiconsIcon
                              icon={Cancel01Icon}
                              strokeWidth={2}
                            />
                          </InputGroupButton>
                        </InputGroupAddon>
                      ) : null}
                    </InputGroup>
                  </Field>
                </form>

                {activeDataset === 'masterlist' &&
                search.government !== 'no' ? (
                  <Toggle
                    variant="outline"
                    size="sm"
                    pressed={search.government === 'yes'}
                    aria-label={`Show government customers only (${result?.facets.governmentCustomers ?? 0})`}
                    onPressedChange={(pressed) =>
                      updateSearch({ government: pressed ? 'yes' : 'all' })
                    }
                  >
                    Government only
                    <Badge variant="secondary" className="tabular-nums">
                      {result
                        ? result.facets.governmentCustomers.toLocaleString()
                        : '—'}
                    </Badge>
                  </Toggle>
                ) : null}

                {activeDataset === 'masterlist' &&
                search.government === 'no' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="Clear not marked government filter"
                    onClick={() => updateSearch({ government: 'all' })}
                  >
                    Not marked government
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      data-icon="inline-end"
                      strokeWidth={2}
                    />
                  </Button>
                ) : null}

                {hasHiddenFilters ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={clearFilters}
                  >
                    <HugeiconsIcon
                      icon={FilterResetIcon}
                      data-icon="inline-start"
                      strokeWidth={2}
                    />
                    Clear filters
                  </Button>
                ) : null}

                {isLoading && result ? (
                  <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      className="size-4 animate-spin"
                      strokeWidth={2}
                    />
                    Updating
                  </span>
                ) : null}
              </div>

              {loadError ? (
                <Alert variant="destructive">
                  <AlertTitle>Unable to load reference data</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>{loadError}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={refresh}
                    >
                      <HugeiconsIcon
                        icon={RefreshIcon}
                        data-icon="inline-start"
                        strokeWidth={2}
                      />
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="min-h-64 max-h-[calc(100vh-22rem)] overflow-auto rounded-md border [&>[data-slot=table-container]]:overflow-visible">
                <DatasetTable
                  dataset={activeDataset}
                  result={result}
                  isInitialLoading={isLoading && !result}
                  search={search}
                  hasActiveQuery={hasActiveQuery}
                  onEdit={openEdit}
                  onDelete={setDeleteRow}
                  onSort={handleSort}
                  onClear={clearSearchAndFilters}
                  onAdd={openCreate}
                />
              </div>
            </CardContent>
            <Separator />
            <CardFooter className="flex-wrap justify-between gap-3">
              <p className="text-sm text-muted-foreground tabular-nums">
                {startRow.toLocaleString()}–{endRow.toLocaleString()} of{' '}
                {(result?.total ?? 0).toLocaleString()}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-sm text-muted-foreground">Rows</span>
                <Select
                  value={String(search.pageSize)}
                  onValueChange={(value) => {
                    const pageSize = Number(value)
                    if (
                      REFERENCE_DATA_PAGE_SIZE_OPTIONS.includes(
                        pageSize as (typeof REFERENCE_DATA_PAGE_SIZE_OPTIONS)[number],
                      )
                    ) {
                      updateSearch({
                        pageSize:
                          pageSize as (typeof REFERENCE_DATA_PAGE_SIZE_OPTIONS)[number],
                      })
                    }
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Rows per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="top">
                    <SelectGroup>
                      {REFERENCE_DATA_PAGE_SIZE_OPTIONS.map((pageSize) => (
                        <SelectItem key={pageSize} value={String(pageSize)}>
                          {pageSize}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <span className="min-w-24 text-center text-sm text-muted-foreground tabular-nums">
                  Page {currentPage} of {totalPages}
                </span>
                <IconActionTooltip label="First page">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label="First page"
                    disabled={isLoading || currentPage <= 1}
                    onClick={() =>
                      updateSearch({ page: 1 }, { resetPage: false })
                    }
                  >
                    <HugeiconsIcon icon={ArrowLeftDoubleIcon} strokeWidth={2} />
                  </Button>
                </IconActionTooltip>
                <IconActionTooltip label="Previous page">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label="Previous page"
                    disabled={isLoading || currentPage <= 1}
                    onClick={() =>
                      updateSearch(
                        { page: Math.max(1, currentPage - 1) },
                        { resetPage: false },
                      )
                    }
                  >
                    <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
                  </Button>
                </IconActionTooltip>
                <IconActionTooltip label="Next page">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label="Next page"
                    disabled={isLoading || currentPage >= totalPages}
                    onClick={() =>
                      updateSearch(
                        { page: Math.min(totalPages, currentPage + 1) },
                        { resetPage: false },
                      )
                    }
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                  </Button>
                </IconActionTooltip>
                <IconActionTooltip label="Last page">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label="Last page"
                    disabled={isLoading || currentPage >= totalPages}
                    onClick={() =>
                      updateSearch({ page: totalPages }, { resetPage: false })
                    }
                  >
                    <HugeiconsIcon
                      icon={ArrowRightDoubleIcon}
                      strokeWidth={2}
                    />
                  </Button>
                </IconActionTooltip>
              </div>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      <ReferenceDataImportSheet
        dataset={activeDataset}
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onImported={refresh}
      />

      <ReferenceDataRowSheet
        key={`${activeDataset}-${editor.key}`}
        dataset={activeDataset}
        editor={editor}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
        onSaved={refresh}
      />

      <AlertDialog
        open={Boolean(deleteRow)}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteRow(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteLabel}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {getDeleteDescription(activeDataset)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {isDeleting ? 'Deleting…' : 'Delete row'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}
