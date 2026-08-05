/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import type { ComponentProps } from 'react'
import type { Root } from 'react-dom/client'

import type { IntakeBatchView } from '@/lib/upload-intake-types'
import { defaultBatchDetailSearch } from '@/lib/batch-file-search-state'
import {
  UploadBatchDetailPage,
  canDeleteUploadBatch,
  canDownloadBatchSignedCertificates,
  canExportBatchBir2307,
  canOpenBatchSigningWorkspace,
  hasBatchDownloadActions,
} from '@/components/upload-batch-detail-page'

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & {
    size?: string
    variant?: string
  }) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/status-pill', () => ({
  StatusPill: ({ status }: { status: string }) => <span>{status}</span>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
    title,
  }: React.ComponentProps<'button'>) => (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled ? 'true' : undefined}
      data-disabled={disabled ? '' : undefined}
      title={title}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({
    children,
    render,
  }: {
    children: React.ReactNode
    render?: React.ReactElement<React.ComponentProps<'button'>>
  }) => (
    <button type="button" {...render?.props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({
    children,
    value,
  }: {
    children: React.ReactNode
    value: string
  }) => (value === 'overview' ? <div>{children}</div> : null),
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: () => null,
  AlertDialogAction: ({
    children,
    ...props
  }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({
    children,
    ...props
  }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: () => null,
  SheetClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  SheetFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

const defaultCounts: IntakeBatchView['counts'] = {
  pending: 0,
  uploaded: 0,
  queued: 0,
  processing: 0,
  success: 2,
  duplicate: 0,
  error: 0,
}

const buildCounts = (
  overrides: Partial<IntakeBatchView['counts']> = {},
): IntakeBatchView['counts'] => ({
  ...defaultCounts,
  ...overrides,
})

const defaultBatch = (
  overrides: Partial<IntakeBatchView> = {},
): IntakeBatchView => ({
  id: 'batch-1',
  name: 'April Certificates',
  filesMode: 'summary',
  entity: {
    id: 1,
    shortName: 'ACME',
    companyName: 'ACME Corporation',
    tin: '123456789',
  },
  createdByUserId: 'user-1',
  status: 'closed',
  overallStatus: 'Completed',
  canSignBatch: true,
  batchSigningStatus: 'signed',
  totalFiles: 2,
  openAttentionCount: 0,
  counts: buildCounts(),
  lastActivityAt: '2026-06-01T08:00:00.000Z',
  closedAt: '2026-06-01T09:00:00.000Z',
  deletedAt: null,
  deletedByUserId: null,
  purgeAfterAt: null,
  createdAt: '2026-06-01T07:00:00.000Z',
  updatedAt: '2026-06-01T09:00:00.000Z',
  files: [],
  ...overrides,
})

const buildDeleteCandidate = (
  overrides: Partial<
    Pick<
      IntakeBatchView,
      'status' | 'deletedAt' | 'counts' | 'deletionEligibility'
    >
  > = {},
) => ({
  status: 'closed' as const,
  deletedAt: null,
  counts: buildCounts(),
  ...overrides,
})

const fetchMock = vi.fn()
const roots: Array<Root> = []
const globalWithActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
globalWithActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const renderBatchDetail = async (
  props: Partial<ComponentProps<typeof UploadBatchDetailPage>> = {},
) => {
  const handlers = {
    onCloseBatch: vi.fn(),
    onReopenBatch: vi.fn(),
    onDeleteBatch: vi.fn(),
    onExportBir2307: vi.fn(),
    onDownloadSignedCertificates: vi.fn(),
    onOpenSigning: vi.fn(),
    onOpenDestination: vi.fn(),
    onRenameBatch: vi.fn().mockResolvedValue(true),
    onRefresh: vi.fn(),
    onSearchChange: vi.fn(),
  }

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  await React.act(() => {
    root.render(
      <UploadBatchDetailPage
        batch={defaultBatch()}
        isRefreshing={false}
        isAutoRefreshing={false}
        lastRefreshedLabel="Jun 27, 2026, 4:32 PM"
        isClosingBatch={false}
        isReopeningBatch={false}
        isDeletingBatch={false}
        isExportingBir2307={false}
        isDownloadingSignedCertificates={false}
        canManageBatchActions
        canAccessSigning
        canExportSheet
        canDownloadSignedPdf
        loadError={null}
        search={defaultBatchDetailSearch}
        {...handlers}
        {...props}
      />,
    )
  })

  return handlers
}

const getElementName = (element: Element) =>
  element.getAttribute('aria-label') || element.textContent

const queryButton = (name: RegExp) =>
  Array.from(document.querySelectorAll<HTMLElement>('button')).find((element) =>
    name.test(getElementName(element)),
  ) ?? null

const getButton = (name: RegExp) => {
  const button = queryButton(name)
  if (!button) {
    throw new Error(`Expected button matching ${name.toString()}`)
  }

  return button
}

const queryMenuItem = (name: RegExp, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (element) => name.test(element.textContent),
  ) ?? null

const getMenuItem = (name: RegExp, root: ParentNode = document) => {
  const item = queryMenuItem(name, root)
  if (!item) {
    throw new Error(`Expected menu item matching ${name.toString()}`)
  }

  return item
}

const getMenuContaining = (name: RegExp) => {
  const menu = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menu"]'),
  ).find((element) => queryMenuItem(name, element))
  if (!menu) {
    throw new Error(`Expected menu containing ${name.toString()}`)
  }

  return menu
}

const clickElement = async (element: HTMLElement) => {
  await React.act(async () => {
    element.click()
    await Promise.resolve()
  })
}

const openDownloadMenu = async () => {
  await clickElement(getButton(/download batch outputs/i))

  return getMenuContaining(/bir 2307 workbook|exporting workbook/i)
}

const isDisabledMenuItem = (item: HTMLElement) =>
  item.getAttribute('aria-disabled') === 'true' ||
  item.hasAttribute('data-disabled')

beforeEach(() => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        files: [],
        pagination: {
          page: 1,
          pageSize: 10,
          totalItems: 0,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        filterOptions: { statuses: [] },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  for (const root of roots) {
    React.act(() => {
      root.unmount()
    })
  }
  roots.length = 0
  document.body.innerHTML = ''
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('canExportBatchBir2307', () => {
  it('allows export for closed batches when sheet export is allowed', () => {
    expect(canExportBatchBir2307({ status: 'closed' }, true)).toBe(true)
  })

  it('blocks export when sheet export is not allowed', () => {
    expect(canExportBatchBir2307({ status: 'closed' }, false)).toBe(false)
  })

  it('blocks export while the batch is open', () => {
    expect(canExportBatchBir2307({ status: 'open' }, true)).toBe(false)
  })

  it('blocks export while the batch has not loaded', () => {
    expect(canExportBatchBir2307(null, true)).toBe(false)
  })
})

describe('canDeleteUploadBatch', () => {
  it('allows delete for closed active batches with only terminal upload outcomes', () => {
    expect(canDeleteUploadBatch(buildDeleteCandidate(), true)).toBe(true)

    expect(
      canDeleteUploadBatch(
        buildDeleteCandidate({
          counts: buildCounts({
            success: 1,
            duplicate: 1,
            error: 1,
          }),
        }),
        true,
      ),
    ).toBe(true)
  })

  it('blocks delete for open batches', () => {
    expect(
      canDeleteUploadBatch(
        buildDeleteCandidate({ status: 'open', counts: buildCounts() }),
        true,
      ),
    ).toBe(false)
  })

  it('blocks delete without batch management access', () => {
    expect(canDeleteUploadBatch(buildDeleteCandidate(), false)).toBe(false)
  })

  it('blocks delete for batches already in Recently Deleted', () => {
    expect(
      canDeleteUploadBatch(
        buildDeleteCandidate({
          deletedAt: '2026-04-20T10:00:00.000Z',
        }),
        true,
      ),
    ).toBe(false)
  })

  it.each(['signed', 'merged', 'purge_in_progress'] as const)(
    'shows batch protection for %s content',
    (code) => {
      expect(
        canDeleteUploadBatch(
          buildDeleteCandidate({
            deletionEligibility: {
              canDelete: false,
              code,
              reason: 'Protected content cannot be deleted.',
            },
          }),
          true,
        ),
      ).toBe(false)
    },
  )

  it.each([
    ['pending', { pending: 1 }],
    ['uploaded', { uploaded: 1 }],
    ['queued', { queued: 1 }],
    ['processing', { processing: 1 }],
  ] as const)('blocks delete while %s uploads remain', (_label, counts) => {
    expect(
      canDeleteUploadBatch(
        buildDeleteCandidate({ counts: buildCounts(counts) }),
        true,
      ),
    ).toBe(false)
  })
})

describe('canOpenBatchSigningWorkspace', () => {
  it('allows Tax Manager signing access for closed signable batches', () => {
    expect(
      canOpenBatchSigningWorkspace(
        {
          status: 'closed',
          canSignBatch: true,
          batchSigningStatus: 'unsigned',
        },
        true,
      ),
    ).toBe(true)
  })

  it('allows Tax Manager signing access for already signed batches', () => {
    expect(
      canOpenBatchSigningWorkspace(
        {
          status: 'closed',
          canSignBatch: false,
          batchSigningStatus: 'signed',
        },
        true,
      ),
    ).toBe(true)
  })

  it('blocks signing workspace access without Tax Manager signing permission', () => {
    expect(
      canOpenBatchSigningWorkspace(
        {
          status: 'closed',
          canSignBatch: true,
          batchSigningStatus: 'unsigned',
        },
        false,
      ),
    ).toBe(false)
  })

  it('blocks signing workspace access for open or unavailable batches', () => {
    expect(
      canOpenBatchSigningWorkspace(
        {
          status: 'open',
          canSignBatch: true,
          batchSigningStatus: 'unsigned',
        },
        true,
      ),
    ).toBe(false)
    expect(
      canOpenBatchSigningWorkspace(
        {
          status: 'closed',
          canSignBatch: false,
          batchSigningStatus: 'unavailable',
        },
        true,
      ),
    ).toBe(false)
    expect(canOpenBatchSigningWorkspace(null, true)).toBe(false)
  })
})

describe('canDownloadBatchSignedCertificates', () => {
  it('allows signed PDF downloads for partial or fully signed closed batches', () => {
    expect(
      canDownloadBatchSignedCertificates(
        { status: 'closed', batchSigningStatus: 'partial' },
        true,
      ),
    ).toBe(true)
    expect(
      canDownloadBatchSignedCertificates(
        { status: 'closed', batchSigningStatus: 'signed' },
        true,
      ),
    ).toBe(true)
  })

  it('blocks signed PDF downloads for unsigned, unavailable, open, or unpermitted batches', () => {
    expect(
      canDownloadBatchSignedCertificates(
        { status: 'closed', batchSigningStatus: 'unsigned' },
        true,
      ),
    ).toBe(false)
    expect(
      canDownloadBatchSignedCertificates(
        { status: 'closed', batchSigningStatus: 'unavailable' },
        true,
      ),
    ).toBe(false)
    expect(
      canDownloadBatchSignedCertificates(
        { status: 'open', batchSigningStatus: 'signed' },
        true,
      ),
    ).toBe(false)
    expect(
      canDownloadBatchSignedCertificates(
        { status: 'closed', batchSigningStatus: 'signed' },
        false,
      ),
    ).toBe(false)
    expect(canDownloadBatchSignedCertificates(null, true)).toBe(false)
  })
})

describe('hasBatchDownloadActions', () => {
  it('shows batch output downloads only for closed batches', () => {
    expect(hasBatchDownloadActions({ status: 'closed' })).toBe(true)
    expect(hasBatchDownloadActions({ status: 'open' })).toBe(false)
    expect(hasBatchDownloadActions(null)).toBe(false)
  })
})

describe('UploadBatchDetailPage download actions', () => {
  it('groups signed PDFs and workbook downloads for closed signed batches', async () => {
    const handlers = await renderBatchDetail()

    const menu = await openDownloadMenu()

    expect(getMenuItem(/signed pdfs \(\.zip\)/i, menu)).toBeTruthy()
    expect(getMenuItem(/bir 2307 workbook \(\.xlsx\)/i, menu)).toBeTruthy()

    await clickElement(getMenuItem(/signed pdfs \(\.zip\)/i, menu))
    expect(handlers.onDownloadSignedCertificates).toHaveBeenCalledTimes(1)

    const reopenedMenu = await openDownloadMenu()
    await clickElement(
      getMenuItem(/bir 2307 workbook \(\.xlsx\)/i, reopenedMenu),
    )
    expect(handlers.onExportBir2307).toHaveBeenCalledTimes(1)
  })

  it('shows signed PDFs for partial batches', async () => {
    await renderBatchDetail({
      batch: defaultBatch({ batchSigningStatus: 'partial' }),
    })

    expect(
      getMenuItem(/signed pdfs \(\.zip\)/i, await openDownloadMenu()),
    ).toBeTruthy()
  })

  it('shows workbook only for unsigned batches', async () => {
    await renderBatchDetail({
      batch: defaultBatch({ batchSigningStatus: 'unsigned' }),
    })

    const menu = await openDownloadMenu()
    expect(queryMenuItem(/signed pdfs \(\.zip\)/i, menu)).toBeNull()
    expect(getMenuItem(/bir 2307 workbook \(\.xlsx\)/i, menu)).toBeTruthy()
  })

  it('hides the Download dropdown for open batches', async () => {
    await renderBatchDetail({
      batch: defaultBatch({
        status: 'open',
        closedAt: null,
        batchSigningStatus: 'unsigned',
      }),
    })

    expect(queryButton(/download batch outputs/i)).toBeNull()
  })

  it('keeps PDF and sheet permissions isolated inside the Download menu', async () => {
    await renderBatchDetail({
      canDownloadSignedPdf: false,
      canExportSheet: false,
    })

    const menu = await openDownloadMenu()
    const signedItem = getMenuItem(/signed pdfs \(\.zip\)/i, menu)
    const workbookItem = getMenuItem(/bir 2307 workbook \(\.xlsx\)/i, menu)

    expect(isDisabledMenuItem(signedItem)).toBe(true)
    expect(isDisabledMenuItem(workbookItem)).toBe(true)
  })

  it('shows progress labels for active download actions', async () => {
    await renderBatchDetail({
      isDownloadingSignedCertificates: true,
      isExportingBir2307: true,
    })

    const menu = await openDownloadMenu()

    expect(getMenuItem(/downloading signed pdfs/i, menu)).toBeTruthy()
    expect(getMenuItem(/exporting workbook/i, menu)).toBeTruthy()
  })

  it('keeps More batch actions reserved for management actions', async () => {
    await renderBatchDetail()

    await clickElement(getButton(/more batch actions/i))
    const menu = getMenuContaining(/rename/i)

    expect(getMenuItem(/rename/i, menu)).toBeTruthy()
    expect(getMenuItem(/re-open batch/i, menu)).toBeTruthy()
    expect(getMenuItem(/delete batch/i, menu)).toBeTruthy()
    expect(queryMenuItem(/signed pdfs/i, menu)).toBeNull()
    expect(queryMenuItem(/bir 2307 workbook/i, menu)).toBeNull()
  })

  it('disables delete while closed batch files are still processing', async () => {
    await renderBatchDetail({
      batch: defaultBatch({
        counts: buildCounts({
          success: 1,
          processing: 1,
        }),
      }),
    })

    await clickElement(getButton(/more batch actions/i))
    const menu = getMenuContaining(/delete batch/i)
    const deleteItem = getMenuItem(/delete batch/i, menu)

    expect(isDisabledMenuItem(deleteItem)).toBe(true)
    expect(deleteItem.getAttribute('title')).toBe(
      'Wait until every uploaded 2307 file finishes processing before deleting this batch.',
    )
  })
})
