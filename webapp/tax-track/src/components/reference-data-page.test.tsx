/* @vitest-environment jsdom */

import { fireEvent, screen } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'

import type { ReferenceDataRouteSearch } from '@/lib/reference-data-search-state'

import { ReferenceDataPage } from '@/components/reference-data-page'
import { parseReferenceDataSearch } from '@/lib/reference-data-search-state'

const testMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useSession: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => testMocks.navigate,
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: testMocks.useSession,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: testMocks.toastError,
    success: testMocks.toastSuccess,
  },
}))

vi.mock('@/components/app-shell', () => ({
  AppShell: ({
    title,
    subtitle,
    actions,
    children,
  }: {
    title: string
    subtitle?: string
    actions?: React.ReactNode
    children: React.ReactNode
  }) => (
    <main>
      <header>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {actions}
      </header>
      {children}
    </main>
  ),
}))

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

vi.mock('@/components/ui/badge', () => ({
  Badge: ({
    children,
    variant: _variant,
    ...props
  }: React.ComponentProps<'span'> & { variant?: string }) => (
    <span {...props}>{children}</span>
  ),
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: Omit<React.ComponentProps<'input'>, 'onChange'> & {
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}))

vi.mock('@/components/ui/toggle', () => ({
  Toggle: ({
    children,
    pressed,
    onPressedChange,
    size: _size,
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & {
    pressed?: boolean
    onPressedChange?: (pressed: boolean) => void
    size?: string
    variant?: string
  }) => (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange?.(!pressed)}
      {...props}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@/components/ui/field', () => ({
  Field: ({
    children,
    orientation: _orientation,
    ...props
  }: React.ComponentProps<'div'> & { orientation?: string }) => (
    <div {...props}>{children}</div>
  ),
  FieldDescription: (props: React.ComponentProps<'p'>) => <p {...props} />,
  FieldError: (props: React.ComponentProps<'div'>) => (
    <div role="alert" {...props} />
  ),
  FieldGroup: (props: React.ComponentProps<'div'>) => <div {...props} />,
  FieldLabel: (props: React.ComponentProps<'label'>) => <label {...props} />,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({
    children,
    size: _size,
    ...props
  }: React.ComponentProps<'button'> & { size?: string }) => (
    <button type="button" role="combobox" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: React.ReactNode }) => (
    <span>{placeholder}</span>
  ),
}))

vi.mock('@/components/ui/separator', () => ({
  Separator: (props: React.ComponentProps<'hr'>) => <hr {...props} />,
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  SheetDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  SheetFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open?: boolean
  }) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({
    children,
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & { variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    ...props
  }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div role="alertdialog">{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

const masterlistRow = {
  id: 7,
  region: 'NCR',
  entity: 'Manila',
  shortName: 'ALPHA',
  customerName: 'Alpha Customer',
  tin: '123456789',
  address: 'Makati City',
  emailAddress: 'alpha@example.com',
  isGovernment: false,
}

const buildListPayload = ({
  rows = [masterlistRow],
  total = rows.length,
  page = 1,
  pageSize = 25,
}: {
  rows?: Array<typeof masterlistRow>
  total?: number
  page?: number
  pageSize?: number
} = {}) => ({
  dataset: 'masterlist',
  rows,
  total,
  page,
  pageSize,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
  facets: {
    regions: ['NCR'],
    entities: ['Manila'],
    taxTypes: [],
    rates: [],
    governmentCustomers: 9,
  },
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const mockFetch = (listResponse: Response, dataset = 'masterlist') => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/reference-data/summary') {
      return Promise.resolve(
        jsonResponse({
          totals: { masterlist: 31, entities: 12, 'atc-codes': 8 },
        }),
      )
    }
    if (url.startsWith(`/api/reference-data/${dataset}?`)) {
      return Promise.resolve(listResponse.clone())
    }
    return Promise.resolve(jsonResponse({ error: 'Unexpected request' }, 500))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const roots: Array<Root> = []

const renderPage = async (search: ReferenceDataRouteSearch) => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  await React.act(async () => {
    root.render(<ReferenceDataPage search={search} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  return root
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  testMocks.useSession.mockReturnValue({
    data: {
      user: {
        id: 'super-admin-1',
        email: 'admin@example.com',
        role: 'super_admin',
      },
    },
    isPending: false,
  })
  window.scrollTo = vi.fn()
})

afterEach(() => {
  for (const root of roots) {
    React.act(() => root.unmount())
  }
  roots.length = 0
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ReferenceDataPage', () => {
  it('uses search as the primary control for entities and ATC codes', async () => {
    mockFetch(
      jsonResponse({
        dataset: 'entities',
        rows: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 1,
        facets: {
          regions: [],
          entities: [],
          taxTypes: [],
          rates: [],
          governmentCustomers: 0,
        },
      }),
      'entities',
    )
    const entitiesRoot = await renderPage(
      parseReferenceDataSearch({ dataset: 'entities' }),
    )

    expect(
      screen.getByPlaceholderText('Search company, TIN, short name, or email…'),
    ).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /Filter by/ })).toBeNull()

    React.act(() => entitiesRoot.unmount())
    roots.splice(roots.indexOf(entitiesRoot), 1)
    vi.clearAllMocks()
    mockFetch(
      jsonResponse({
        dataset: 'atc-codes',
        rows: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 1,
        facets: {
          regions: [],
          entities: [],
          taxTypes: ['Income Tax'],
          rates: [0.02],
          governmentCustomers: 0,
        },
      }),
      'atc-codes',
    )
    await renderPage(parseReferenceDataSearch({ dataset: 'atc-codes' }))

    expect(
      screen.getByPlaceholderText('Search ATC code, tax type, or description…'),
    ).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /Filter by/ })).toBeNull()
  })

  it('renders the counted government quick filter, sorting, and pagination', async () => {
    mockFetch(jsonResponse(buildListPayload({ total: 31 })))
    await renderPage(parseReferenceDataSearch({ dataset: 'masterlist' }))

    expect(await screen.findByText('Alpha Customer')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /Filter by/ })).toBeNull()
    const governmentToggle = screen.getByRole('button', {
      name: 'Show government customers only (9)',
    })
    expect(governmentToggle.getAttribute('aria-pressed')).toBe('false')
    expect(
      screen
        .getByRole('columnheader', { name: /Customer/ })
        .getAttribute('aria-sort'),
    ).toBe('ascending')
    expect(screen.getByText('1–25 of 31')).toBeTruthy()
    expect(screen.getByText('Page 1 of 2')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'First page' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Next page' })
        .hasAttribute('disabled'),
    ).toBe(false)
    expect(screen.getByText('31')).toBeTruthy()

    React.act(() => fireEvent.click(governmentToggle))
    expect(testMocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ government: 'yes', page: 1 }),
      }),
    )

    testMocks.navigate.mockClear()
    React.act(() =>
      fireEvent.click(screen.getByRole('button', { name: /Customer/ })),
    )
    expect(testMocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({
          sort: 'customerName',
          direction: 'desc',
          page: 1,
        }),
      }),
    )
  })

  it('commits search after 300 ms and immediately on Enter', async () => {
    mockFetch(jsonResponse(buildListPayload()))
    await renderPage(parseReferenceDataSearch({ dataset: 'masterlist' }))
    await screen.findByText('Alpha Customer')

    vi.useFakeTimers()
    const searchInput = screen.getByRole('searchbox', {
      name: 'Search Masterlist',
    })
    React.act(() =>
      fireEvent.change(searchInput, { target: { value: 'alpha' } }),
    )
    expect(testMocks.navigate).not.toHaveBeenCalled()

    React.act(() => vi.advanceTimersByTime(299))
    expect(testMocks.navigate).not.toHaveBeenCalled()
    React.act(() => vi.advanceTimersByTime(1))
    expect(testMocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ q: 'alpha', page: 1 }),
      }),
    )

    testMocks.navigate.mockClear()
    React.act(() =>
      fireEvent.change(searchInput, { target: { value: 'beta' } }),
    )
    React.act(() =>
      fireEvent.submit(searchInput.closest('form') as HTMLFormElement),
    )
    expect(testMocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ q: 'beta', page: 1 }),
      }),
    )
  })

  it('clears active filters and resets pagination in route search', async () => {
    mockFetch(
      jsonResponse(buildListPayload({ total: 60, page: 3, pageSize: 25 })),
    )
    await renderPage(
      parseReferenceDataSearch({
        dataset: 'masterlist',
        region: 'NCR',
        page: 3,
      }),
    )
    await screen.findByText('Alpha Customer')

    React.act(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })),
    )

    expect(testMocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ region: '', page: 1 }),
      }),
    )
  })

  it('shows field-level validation and dataset-specific delete copy', async () => {
    mockFetch(jsonResponse(buildListPayload()))
    await renderPage(parseReferenceDataSearch({ dataset: 'masterlist' }))
    await screen.findByText('Alpha Customer')

    React.act(() =>
      fireEvent.click(screen.getAllByRole('button', { name: 'Add row' })[0]),
    )
    const sheet = await screen.findByRole('dialog')
    expect(screen.getByText('Add masterlist row')).toBeTruthy()
    React.act(() =>
      fireEvent.click(
        screen
          .getAllByRole('button', { name: 'Add row' })
          .find((button) => sheet.contains(button)) as HTMLButtonElement,
      ),
    )
    expect(
      await screen.findByText('Enter a customer name, short name, or TIN.'),
    ).toBeTruthy()
    expect(
      screen.getByLabelText('Customer name').getAttribute('aria-invalid'),
    ).toBe('true')

    React.act(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' })),
    )
    React.act(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Delete row' })),
    )
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('Delete “Alpha Customer”?')).toBeTruthy()
    expect(
      screen.getByText(
        'This action cannot be undone. The customer will no longer be available for future masterlist matching.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/upload batch or sales report/i)).toBeNull()
  })

  it('offers clear and retry actions for empty and failed results', async () => {
    mockFetch(jsonResponse(buildListPayload({ rows: [], total: 0 })))
    const emptyRoot = await renderPage(
      parseReferenceDataSearch({
        dataset: 'masterlist',
        q: 'missing',
      }),
    )

    expect(
      await screen.findByRole('button', { name: 'Clear search and filters' }),
    ).toBeTruthy()
    React.act(() =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Clear search and filters' }),
      ),
    )
    expect(testMocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ q: '', page: 1 }),
      }),
    )
    React.act(() => emptyRoot.unmount())
    roots.splice(roots.indexOf(emptyRoot), 1)

    vi.clearAllMocks()
    mockFetch(jsonResponse({ error: 'Database unavailable' }, 503))
    await renderPage(parseReferenceDataSearch({ dataset: 'masterlist' }))

    expect(
      await screen.findByText('Unable to load reference data'),
    ).toBeTruthy()
    expect(screen.getByText('Database unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
