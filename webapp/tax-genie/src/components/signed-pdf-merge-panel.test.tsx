/* @vitest-environment jsdom */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'

import { SignedPdfMergePanel } from '@/components/signed-pdf-merge-panel'

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/lib/product-tours', () => ({
  getProductTourTargetProps: () => ({}),
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

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<'button'> & {
    variant?: string
    size?: string
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
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
      {...props}
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/components/ui/field', () => {
  const Div = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  )
  const Label = ({ children, ...props }: React.ComponentProps<'label'>) => (
    <label {...props}>{children}</label>
  )

  return {
    Field: Div,
    FieldDescription: Div,
    FieldError: Div,
    FieldGroup: Div,
    FieldLabel: Label,
  }
})

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@/components/ui/select', () => {
  const Div = ({
    children,
    onValueChange: _onValueChange,
    value: _value,
    ...props
  }: React.ComponentProps<'div'> & {
    onValueChange?: (value: string | null) => void
    value?: string
  }) => <div {...props}>{children}</div>
  const Button = ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )

  return {
    Select: Div,
    SelectContent: Div,
    SelectGroup: Div,
    SelectItem: ({
      children,
      value: _value,
      ...props
    }: React.ComponentProps<'div'> & { value?: string }) => (
      <div {...props}>{children}</div>
    ),
    SelectLabel: Div,
    SelectTrigger: Button,
    SelectValue: ({ placeholder }: { placeholder?: string }) => (
      <span>{placeholder}</span>
    ),
  }
})

vi.mock('@/components/ui/sheet', () => {
  const Div = ({
    children,
    onOpenChange: _onOpenChange,
    open: _open,
    ...props
  }: React.ComponentProps<'div'> & {
    onOpenChange?: (open: boolean) => void
    open?: boolean
  }) => <div {...props}>{children}</div>

  return {
    Sheet: Div,
    SheetClose: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    SheetContent: ({
      children,
      showCloseButton: _showCloseButton,
      side: _side,
      ...props
    }: React.ComponentProps<'div'> & {
      showCloseButton?: boolean
      side?: string
    }) => <div {...props}>{children}</div>,
    SheetDescription: Div,
    SheetFooter: Div,
    SheetHeader: Div,
    SheetTitle: Div,
  }
})

vi.mock('@/components/ui/toggle-group', () => ({
  ToggleGroup: ({
    children,
    onValueChange: _onValueChange,
    value: _value,
    ...props
  }: React.ComponentProps<'div'> & {
    onValueChange?: (value: Array<string>) => void
    value?: Array<string>
  }) => <div {...props}>{children}</div>,
  ToggleGroupItem: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({
    children,
    render: _render,
    ...props
  }: React.ComponentProps<'button'> & { render?: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

const batchOneId = '11111111-1111-4111-8111-111111111111'
const batchTwoId = '22222222-2222-4222-8222-222222222222'
const currentYear = new Date().getFullYear()

const createJsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const createFetchMock = ({
  batchPdfCounts = [3, 2],
  previewInputCount = 5,
}: {
  batchPdfCounts?: [number, number]
  previewInputCount?: number
} = {}) =>
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)

    if (url === '/api/merge-jobs/options') {
      return createJsonResponse({
        entities: [
          {
            id: 1,
            shortName: 'TMO',
            companyName: 'Tax Merge Org',
            tin: '004760842',
            hasValidTin: true,
          },
        ],
      })
    }

    if (url.startsWith('/api/merge-jobs/options?')) {
      return createJsonResponse({
        entities: [
          {
            id: 1,
            shortName: 'TMO',
            companyName: 'Tax Merge Org',
            tin: '004760842',
            hasValidTin: true,
          },
        ],
        batches: [
          {
            id: batchOneId,
            name: 'January closed batch',
            status: 'closed',
            closedAt: '2024-01-31T12:00:00.000Z',
            lastActivityAt: '2024-01-31T12:00:00.000Z',
            createdAt: '2024-01-01T12:00:00.000Z',
            eligibleSignedPdfCount: batchPdfCounts[0],
          },
          {
            id: batchTwoId,
            name: 'February closed batch',
            status: 'closed',
            closedAt: '2024-02-29T12:00:00.000Z',
            lastActivityAt: '2024-02-29T12:00:00.000Z',
            createdAt: '2024-02-01T12:00:00.000Z',
            eligibleSignedPdfCount: batchPdfCounts[1],
          },
        ],
      })
    }

    if (url === '/api/merge-jobs?view=recent') {
      return createJsonResponse({
        jobs: [],
        summary: {
          totalJobs: 0,
          activeJobs: 0,
          readyDownloads: 0,
        },
      })
    }

    if (url === '/api/merge-jobs/preview' && init?.method === 'POST') {
      return createJsonResponse({
        preview: {
          totalInputFiles: previewInputCount,
          totalSizeBytes: previewInputCount * 240,
          outputCount: 1,
          lateInputCount: 0,
          candidateRows: [],
          parts: [
            {
              partNumber: 1,
              fileName: 'merged.pdf',
              sizeBytes: previewInputCount * 240,
              inputCount: previewInputCount,
            },
          ],
        },
      })
    }

    return createJsonResponse({ error: `Unhandled fetch ${url}` }, 404)
  })

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = []

const renderPanel = async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  document.body.append(container)
  mountedRoots.push({ container, root })

  await React.act(() => {
    root.render(<SignedPdfMergePanel canExportPdf={true} />)
  })

  return container
}

const waitForAssertion = async (assertion: () => void) => {
  const startedAt = Date.now()
  let latestError: unknown

  while (Date.now() - startedAt < 1500) {
    try {
      assertion()
      return
    } catch (error) {
      latestError = error
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }

  throw latestError
}

const getButtonByText = (container: HTMLElement, label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent.includes(label),
  )

  if (!button) {
    throw new Error(`Unable to find button: ${label}`)
  }

  return button
}

const getSectionByLabel = (container: HTMLElement, label: string) => {
  const section = container.querySelector(`[aria-label="${label}"]`)
  if (!(section instanceof HTMLElement)) {
    throw new Error(`Unable to find section: ${label}`)
  }

  return section
}

const clickButton = async (container: HTMLElement, label: string) => {
  await React.act(() => {
    getButtonByText(container, label).click()
  })
}

const clickBatchCheckbox = async (container: HTMLElement) => {
  const builder = getSectionByLabel(container, 'Upload batch builder')
  const checkbox = builder.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )
  if (!checkbox) {
    throw new Error('Unable to find a batch checkbox')
  }

  await React.act(() => {
    checkbox.click()
  })
}

afterEach(() => {
  for (const { container, root } of mountedRoots.splice(0)) {
    React.act(() => {
      root.unmount()
    })
    container.remove()
  }
  vi.unstubAllGlobals()
})

describe('SignedPdfMergePanel batch selection', () => {
  let fetchMock: ReturnType<typeof createFetchMock>

  beforeEach(() => {
    fetchMock = createFetchMock()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads eligible batches after the selected entity and period are ready', async () => {
    const container = await renderPanel()

    await waitForAssertion(() => {
      expect(container.textContent).toContain('January closed batch')
    })
    const builder = getSectionByLabel(container, 'Upload batch builder')
    expect(builder.textContent).toContain('January closed batch')
    expect(builder.textContent).toContain('February closed batch')
    expect(builder.textContent).toContain('3 PDFs')
    expect(builder.textContent).toContain('2 PDFs')
  })

  it('keeps preview disabled until at least one batch is selected', async () => {
    const container = await renderPanel()

    await waitForAssertion(() => {
      expect(container.textContent).toContain('January closed batch')
    })

    const previewRail = getSectionByLabel(container, 'Package preview')
    const previewButton = getButtonByText(previewRail, 'Preview split')
    expect(previewButton.disabled).toBe(true)

    await clickButton(container, 'Select all')

    await waitForAssertion(() => {
      expect(previewButton.disabled).toBe(false)
    })

    await clickButton(container, 'Clear')

    await waitForAssertion(() => {
      expect(previewButton.disabled).toBe(true)
    })
  })

  it('supports select all, clear selection, and sends selected batch IDs in preview', async () => {
    const container = await renderPanel()

    await waitForAssertion(() => {
      expect(container.textContent).toContain('January closed batch')
    })
    await clickButton(container, 'Select all')

    await waitForAssertion(() => {
      expect(container.textContent).toContain('2 selected')
    })

    await clickButton(container, 'Preview split')

    await waitForAssertion(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === '/api/merge-jobs/preview' &&
            init?.method === 'POST',
        ),
      ).toBe(true)
    })

    const previewCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/merge-jobs/preview' && init?.method === 'POST',
    )
    expect(JSON.parse(String(previewCall?.[1]?.body))).toMatchObject({
      payeeShortName: 'TMO',
      periodType: 'quarterly',
      year: currentYear,
      quarter: 1,
      batchIds: [batchOneId, batchTwoId],
    })

    await clickButton(container, 'Clear')

    await waitForAssertion(() => {
      expect(container.textContent).toContain('0 selected')
    })
  })

  it('clears the package preview when batch selection changes', async () => {
    const container = await renderPanel()

    await waitForAssertion(() => {
      expect(container.textContent).toContain('January closed batch')
    })
    await clickButton(container, 'Select all')
    await clickButton(container, 'Preview split')

    const previewRail = getSectionByLabel(container, 'Package preview')
    await waitForAssertion(() => {
      expect(previewRail.textContent).toContain('5 PDFs')
    })

    await clickButton(container, 'Clear')

    await waitForAssertion(() => {
      expect(previewRail.textContent).toContain(
        'Preview the split to see source packages.',
      )
      expect(previewRail.textContent).not.toContain('5 PDFs')
    })
  })

  it('allows a one-PDF preview but blocks merge submission', async () => {
    fetchMock = createFetchMock({
      batchPdfCounts: [1, 2],
      previewInputCount: 1,
    })
    vi.stubGlobal('fetch', fetchMock)
    const container = await renderPanel()

    await waitForAssertion(() => {
      expect(container.textContent).toContain('January closed batch')
    })
    await clickBatchCheckbox(container)

    const previewRail = getSectionByLabel(container, 'Package preview')
    const previewButton = getButtonByText(previewRail, 'Preview split')
    expect(previewButton.disabled).toBe(false)

    await clickButton(previewRail, 'Preview split')

    await waitForAssertion(() => {
      expect(previewRail.textContent).toContain('More signed PDFs required')
      expect(previewRail.textContent).toContain(
        'At least two signed 2307 PDFs are required to create a merge package.',
      )
      const packageRow = Array.from(previewRail.querySelectorAll('tr')).find(
        (row) => row.textContent.includes('Package 1'),
      )
      expect(packageRow?.textContent).toContain('1 PDF')
    })
    expect(getButtonByText(previewRail, 'Submit merge').disabled).toBe(true)
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === '/api/merge-jobs' && init?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('enables merge submission when the preview contains two PDFs', async () => {
    fetchMock = createFetchMock({
      batchPdfCounts: [2, 1],
      previewInputCount: 2,
    })
    vi.stubGlobal('fetch', fetchMock)
    const container = await renderPanel()

    await waitForAssertion(() => {
      expect(container.textContent).toContain('January closed batch')
    })
    await clickBatchCheckbox(container)
    await clickButton(container, 'Preview split')

    const previewRail = getSectionByLabel(container, 'Package preview')
    await waitForAssertion(() => {
      expect(previewRail.textContent).toContain('2 PDFs')
      expect(getButtonByText(previewRail, 'Submit merge').disabled).toBe(false)
    })
    expect(previewRail.textContent).not.toContain('More signed PDFs required')
  })
})
