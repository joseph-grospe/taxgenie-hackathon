import { useEffect, useState } from 'react'
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
  Search01Icon,
  Upload01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { toast } from 'sonner'
import type { FormEvent } from 'react'

import type {
  AtcCodeReferenceRow,
  EntityReferenceRow,
  MasterlistReferenceRow,
  ReferenceDataDataset,
  ReferenceDataRow,
} from '@/lib/reference-data'

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
import { authClient } from '@/lib/auth-client'
import { isSuperAdmin, parseSessionContext } from '@/lib/access-control'
import {
  REFERENCE_DATA_DEFAULT_PAGE_SIZE,
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
  error?: string
}

type DatasetViewState = {
  draftQuery: string
  query: string
  page: number
}

type RowEditorState = {
  open: boolean
  row: ReferenceDataRow | null
  key: number
}

type DraftValue = string | boolean
type RowDraft = Record<string, DraftValue>

type FieldDefinition = {
  key: string
  label: string
  input?: 'text' | 'email' | 'textarea'
  placeholder?: string
}

const initialViewState: Record<ReferenceDataDataset, DatasetViewState> = {
  masterlist: { draftQuery: '', query: '', page: 1 },
  entities: { draftQuery: '', query: '', page: 1 },
  'atc-codes': { draftQuery: '', query: '', page: 1 },
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
  onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState<RowDraft>(() =>
    buildDraft(dataset, editor.row),
  )
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const definition = referenceDataDefinitions[dataset]
  const isEditing = Boolean(editor.row)

  const updateField = (key: string, value: DraftValue) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    const parsed = buildPayload(dataset, draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid row values.')
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
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <FieldGroup>
              {error ? <FieldError>{error}</FieldError> : null}
              {fieldDefinitions[dataset].map((field) => (
                <Field key={field.key}>
                  <FieldLabel htmlFor={`reference-row-${field.key}`}>
                    {field.label}
                  </FieldLabel>
                  {field.input === 'textarea' ? (
                    <Textarea
                      id={`reference-row-${field.key}`}
                      value={String(draft[field.key] ?? '')}
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
                      onChange={(event) =>
                        updateField(field.key, event.target.value)
                      }
                      disabled={isSaving}
                    />
                  )}
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
  onImported: () => Promise<void>
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
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Edit row"
        onClick={() => onEdit(row)}
      >
        <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Delete row"
        onClick={() => onDelete(row)}
      >
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}

function DatasetTable({
  dataset,
  result,
  isLoading,
  onEdit,
  onDelete,
}: {
  dataset: ReferenceDataDataset
  result: ReferenceDataListResponse | null
  isLoading: boolean
  onEdit: (row: ReferenceDataRow) => void
  onDelete: (row: ReferenceDataRow) => void
}) {
  if (dataset === 'masterlist') {
    const rows = (result?.rows ?? []) as Array<MasterlistReferenceRow>
    return (
      <Table className="min-w-[1100px]">
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>TIN</TableHead>
            <TableHead>Short name</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Government</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? <LoadingRows columnCount={8} /> : null}
          {!isLoading && rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="h-28 text-center text-muted-foreground"
              >
                No masterlist rows match the current search.
              </TableCell>
            </TableRow>
          ) : null}
          {!isLoading
            ? rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-64 truncate font-medium">
                    {displayValue(row.customerName)}
                  </TableCell>
                  <TableCell>{displayValue(row.tin)}</TableCell>
                  <TableCell>{displayValue(row.shortName)}</TableCell>
                  <TableCell>{displayValue(row.entity)}</TableCell>
                  <TableCell>{displayValue(row.region)}</TableCell>
                  <TableCell className="max-w-56 truncate">
                    {displayValue(row.emailAddress)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {row.isGovernment ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>
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
      <Table className="min-w-[1050px]">
        <TableHeader>
          <TableRow>
            <TableHead>Short name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>TIN</TableHead>
            <TableHead>ZIP code</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Region email</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? <LoadingRows columnCount={7} /> : null}
          {!isLoading && rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="h-28 text-center text-muted-foreground"
              >
                No entities match the current search.
              </TableCell>
            </TableRow>
          ) : null}
          {!isLoading
            ? rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {displayValue(row.shortName)}
                  </TableCell>
                  <TableCell className="max-w-72 truncate">
                    {displayValue(row.companyName)}
                  </TableCell>
                  <TableCell>{displayValue(row.tin)}</TableCell>
                  <TableCell>{displayValue(row.zipCode)}</TableCell>
                  <TableCell className="max-w-56 truncate">
                    {displayValue(row.emailAddress)}
                  </TableCell>
                  <TableCell className="max-w-56 truncate">
                    {displayValue(row.regionEmailAddress)}
                  </TableCell>
                  <TableCell>
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
    <Table className="min-w-[760px]">
      <TableHeader>
        <TableRow>
          <TableHead>ATC</TableHead>
          <TableHead>Tax type</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="w-20 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? <LoadingRows columnCount={5} /> : null}
        {!isLoading && rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={5}
              className="h-28 text-center text-muted-foreground"
            >
              No ATC codes match the current search.
            </TableCell>
          </TableRow>
        ) : null}
        {!isLoading
          ? rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.code}</TableCell>
                <TableCell>{row.taxType}</TableCell>
                <TableCell className="max-w-xl truncate">
                  {row.description}
                </TableCell>
                <TableCell className="text-right">{row.rate * 100}%</TableCell>
                <TableCell>
                  <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
                </TableCell>
              </TableRow>
            ))
          : null}
      </TableBody>
    </Table>
  )
}

export function ReferenceDataPage() {
  const { data: session, isPending } = authClient.useSession()
  const [activeDataset, setActiveDataset] =
    useState<ReferenceDataDataset>('masterlist')
  const [views, setViews] = useState(initialViewState)
  const [results, setResults] = useState(initialResults)
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
  const activeView = views[activeDataset]
  const activePage = activeView.page
  const activeQuery = activeView.query

  useEffect(() => {
    if (!canManageReferenceData) {
      return
    }

    const controller = new AbortController()
    const load = async () => {
      setIsLoading(true)
      setLoadError('')
      try {
        const params = new URLSearchParams({
          page: String(activePage),
          pageSize: String(REFERENCE_DATA_DEFAULT_PAGE_SIZE),
        })
        if (activeQuery) {
          params.set('q', activeQuery)
        }
        const response = await fetch(
          `/api/reference-data/${activeDataset}?${params.toString()}`,
          { cache: 'no-store', signal: controller.signal },
        )
        if (!response.ok) {
          throw new Error(
            await getApiError(response, 'Unable to load reference data.'),
          )
        }
        const payload = await readJson<ReferenceDataListResponse>(response)
        setResults((current) => ({ ...current, [activeDataset]: payload }))
        if (payload.page !== activePage) {
          setViews((current) => ({
            ...current,
            [activeDataset]: {
              ...current[activeDataset],
              page: payload.page,
            },
          }))
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
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => controller.abort()
  }, [
    activeDataset,
    activePage,
    activeQuery,
    canManageReferenceData,
    refreshVersion,
  ])

  const refresh = () => {
    setRefreshVersion((current) => current + 1)
  }

  const openCreate = () => {
    setEditor((current) => ({ open: true, row: null, key: current.key + 1 }))
  }

  const openEdit = (row: ReferenceDataRow) => {
    setEditor((current) => ({ open: true, row, key: current.key + 1 }))
  }

  const handleDelete = async () => {
    if (!deleteRow) {
      return
    }

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
      await refresh()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to delete row.'
      toast.error('Row was not deleted', { description: message })
    } finally {
      setIsDeleting(false)
    }
  }

  if (isPending) {
    return null
  }

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

  const result = results[activeDataset]
  const definition = referenceDataDefinitions[activeDataset]

  return (
    <AppShell
      title="Reference Data"
      subtitle="Masterlist, entities, and ATC configuration"
      actions={
        <Button size="sm" onClick={() => setIsImportOpen(true)}>
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
            setActiveDataset(value as ReferenceDataDataset)
            setLoadError('')
          }
        }}
        className="min-h-0 flex-1"
      >
        <TabsList>
          {referenceDataDatasets.map((dataset) => (
            <TabsTrigger key={dataset} value={dataset}>
              {referenceDataDefinitions[dataset].label}
            </TabsTrigger>
          ))}
        </TabsList>
        {referenceDataDatasets.map((dataset) => (
          <TabsContent
            key={dataset}
            value={dataset}
            className="min-h-0 data-[hidden]:hidden"
          >
            {dataset === activeDataset ? (
              <Card className="min-h-0">
                <CardHeader>
                  <CardTitle>{definition.label}</CardTitle>
                  <CardDescription>
                    {result
                      ? `${result.total.toLocaleString()} total rows`
                      : 'Loading row count…'}
                  </CardDescription>
                  <CardAction>
                    <Button size="sm" variant="outline" onClick={openCreate}>
                      <HugeiconsIcon
                        icon={Add01Icon}
                        data-icon="inline-start"
                        strokeWidth={2}
                      />
                      Add row
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-col gap-4">
                  <form
                    className="max-w-md"
                    onSubmit={(event) => {
                      event.preventDefault()
                      setViews((current) => ({
                        ...current,
                        [activeDataset]: {
                          ...current[activeDataset],
                          query: current[activeDataset].draftQuery.trim(),
                          page: 1,
                        },
                      }))
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
                        <InputGroupInput
                          id="reference-data-search"
                          type="search"
                          placeholder={`Search ${definition.label.toLowerCase()}…`}
                          value={activeView.draftQuery}
                          onChange={(event) => {
                            const value = event.target.value
                            setViews((current) => ({
                              ...current,
                              [activeDataset]: {
                                ...current[activeDataset],
                                draftQuery: value,
                              },
                            }))
                          }}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton type="submit" aria-label="Search">
                            <HugeiconsIcon
                              icon={Search01Icon}
                              strokeWidth={2}
                            />
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                    </Field>
                  </form>

                  {loadError ? (
                    <Alert variant="destructive">
                      <AlertTitle>Unable to load reference data</AlertTitle>
                      <AlertDescription>{loadError}</AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="min-h-0 overflow-auto rounded-md border">
                    <DatasetTable
                      dataset={activeDataset}
                      result={result}
                      isLoading={isLoading}
                      onEdit={openEdit}
                      onDelete={setDeleteRow}
                    />
                  </div>
                </CardContent>
                <Separator />
                <CardFooter className="justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {result?.page ?? activePage} of{' '}
                    {result?.totalPages ?? 1}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isLoading || (result?.page ?? activePage) <= 1}
                      onClick={() =>
                        setViews((current) => ({
                          ...current,
                          [activeDataset]: {
                            ...current[activeDataset],
                            page: Math.max(1, current[activeDataset].page - 1),
                          },
                        }))
                      }
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        isLoading ||
                        (result?.page ?? activePage) >=
                          (result?.totalPages ?? 1)
                      }
                      onClick={() =>
                        setViews((current) => ({
                          ...current,
                          [activeDataset]: {
                            ...current[activeDataset],
                            page: current[activeDataset].page + 1,
                          },
                        }))
                      }
                    >
                      Next
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ) : null}
          </TabsContent>
        ))}
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
          if (!open && !isDeleting) {
            setDeleteRow(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this {definition.singularLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Entities referenced by historical
              batches or reports will be blocked.
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
