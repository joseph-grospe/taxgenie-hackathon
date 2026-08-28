/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactNode } from 'react'
import type { IntakeBatchView } from '@/lib/upload-intake-types'

const authMocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  custom: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div>Nested upload route</div>,
  createFileRoute: () => (config: { component: unknown }) => ({
    ...config,
  }),
  lazyRouteComponent: () => () => null,
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => string
  }) => select({ location: { pathname: '/upload' } }),
}))

vi.mock('@tabler/icons-react', () => ({
  IconArrowUpRight: (props: ComponentProps<'span'>) => <span {...props} />,
  IconCheck: (props: ComponentProps<'span'>) => <span {...props} />,
  IconScale: (props: ComponentProps<'span'>) => <span {...props} />,
  IconSignature: (props: ComponentProps<'span'>) => <span {...props} />,
  IconX: (props: ComponentProps<'span'>) => <span {...props} />,
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

vi.mock('@/components/app-shell', () => ({
  AppShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}))

vi.mock('@/components/product-tour', () => ({
  UploadIntakeTour: () => null,
}))

vi.mock('@/components/entity-scope-provider', () => ({
  useEntityScope: () => ({ selectedEntityId: null }),
}))

vi.mock('@/components/upload-intake-page', () => ({
  UploadIntakePage: ({
    activeBatch,
    onCloseBatch,
  }: {
    activeBatch: IntakeBatchView | null
    onCloseBatch: () => void
  }) => (
    <section>
      <p>Active batch {activeBatch?.id ?? 'none'}</p>
      <button type="button" onClick={onCloseBatch}>
        Close batch
      </button>
    </section>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<'button'> & {
    size?: string
    variant?: string
  }) => (
    <button {...props}>
      {Array.isArray(children)
        ? children.map((child, index) => <span key={index}>{child}</span>)
        : children}
    </button>
  ),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: authMocks.useSession,
  },
}))

const {
  buildUploadBatchClosedFlagModel,
  buildUploadBatchNextStepActions,
} = await import('@/routes/upload')

const statusSummary = {
  pending: 0,
  uploaded: 0,
  queued: 0,
  processing: 0,
  success: 2,
  review: 0,
  duplicate: 0,
  error: 0,
}

const buildBatch = (
  overrides: Partial<IntakeBatchView> = {},
): IntakeBatchView => ({
  id: 'batch-1',
  name: 'April certificates',
  filesMode: 'summary',
  entity: {
    id: 12,
    shortName: 'ACME',
    companyName: 'ACME Corporation',
    tin: '123456789',
  },
  createdByUserId: 'user-1',
  status: 'closed',
  overallStatus: 'Completed',
  canSignBatch: true,
  batchSigningStatus: 'unsigned',
  totalFiles: 2,
  openAttentionCount: 0,
  counts: statusSummary,
  lastActivityAt: '2026-04-20T10:00:00.000Z',
  closedAt: '2026-04-20T10:00:00.000Z',
  deletedAt: null,
  deletedByUserId: null,
  purgeAfterAt: null,
  createdAt: '2026-04-20T09:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
  files: [],
  ...overrides,
})

const closedBatch = buildBatch()

afterEach(() => {
  vi.clearAllMocks()
})

describe('buildUploadBatchNextStepActions', () => {
  it('shows both signing and reconciliation for a closed signable batch', () => {
    expect(
      buildUploadBatchNextStepActions(closedBatch, {
        canAccessSigning: true,
      }).map((action) => action.label),
    ).toEqual(['Sign certificates', 'Reconcile batch'])
  })

  it('hides signing when the user cannot access certificate signing', () => {
    expect(
      buildUploadBatchNextStepActions(closedBatch, {
        canAccessSigning: false,
      }).map((action) => action.label),
    ).toEqual(['Reconcile batch'])
  })

  it('hides reconciliation when the batch has no entity or success files', () => {
    expect(
      buildUploadBatchNextStepActions(
        buildBatch({ entity: null }),
        { canAccessSigning: true },
      ).map((action) => action.label),
    ).toEqual(['Sign certificates'])

    expect(
      buildUploadBatchNextStepActions(
        buildBatch({ counts: { ...statusSummary, success: 0 } }),
        { canAccessSigning: true },
      ).map((action) => action.label),
    ).toEqual(['Sign certificates'])
  })

  it('falls back to opening the batch when no downstream action is available', () => {
    expect(
      buildUploadBatchNextStepActions(
        buildBatch({
          entity: null,
          canSignBatch: false,
          batchSigningStatus: 'unavailable',
          counts: { ...statusSummary, success: 0 },
        }),
        { canAccessSigning: true },
      ).map((action) => action.label),
    ).toEqual(['Open batch'])
  })
})

describe('buildUploadBatchClosedFlagModel', () => {
  it('builds a compact flag model from next-step actions', () => {
    const model = buildUploadBatchClosedFlagModel(closedBatch, {
      canAccessSigning: true,
    })

    expect(model).toEqual(
      expect.objectContaining({
        description: 'Choose the next step for this batch.',
        duration: 10_000,
        position: 'bottom-right',
        actions: [
          expect.objectContaining({ label: 'Sign certificates' }),
          expect.objectContaining({ label: 'Reconcile batch' }),
        ],
      }),
    )
  })
})
