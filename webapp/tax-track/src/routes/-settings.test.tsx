/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'

import type {
  DevDataResetStatus,
  SettingsUserFilters,
} from '@/routes/settings'
import type { ManagedUser, UserUpdateInput } from '@/lib/users-module'
import {
  DevDataResetPanel,
  SelectedUserInspector,
  SettingsSummaryStats,
  filterUsers,
  getSelectedUserDraft,
  paginateUsers,
} from '@/routes/settings'
import { teamOptions, userRoles } from '@/lib/user-roles'

const status: DevDataResetStatus = {
  available: true,
  stage: 'dev-app',
  counts: {
    intake_files: 2,
    document_results: 3,
  },
}

const defaultFilters: SettingsUserFilters = {
  search: '',
  role: 'all_roles',
  team: 'all_teams',
  status: 'all_status',
}

const noop = () => undefined

const createUser = (overrides: Partial<ManagedUser> = {}): ManagedUser => ({
  id: overrides.id ?? 'user-1',
  email: overrides.email ?? 'jane.admin@taxdocs.com',
  name: overrides.name ?? 'Jane Admin',
  role: overrides.role ?? 'admin',
  team: overrides.team ?? 'tax_team',
  canExportPdf: overrides.canExportPdf ?? true,
  canExportExcel: overrides.canExportExcel ?? true,
  mustChangePassword: overrides.mustChangePassword ?? false,
  isBanned: overrides.isBanned ?? false,
  createdAt: overrides.createdAt ?? '2025-05-01T09:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2025-05-02T09:00:00.000Z',
})

const users: Array<ManagedUser> = [
  createUser({
    id: 'admin-1',
    email: 'jane.admin@taxdocs.com',
    name: 'Jane Admin',
    role: 'admin',
    team: 'tax_manager',
    canExportPdf: true,
    canExportExcel: true,
  }),
  createUser({
    id: 'editor-1',
    email: 'eric.editor@taxdocs.com',
    name: 'Eric Editor',
    role: 'editor',
    team: 'tax_team',
    canExportPdf: true,
    canExportExcel: false,
  }),
  createUser({
    id: 'viewer-1',
    email: 'vera.viewer@taxdocs.com',
    name: 'Vera Viewer',
    role: 'viewer',
    team: 'ar_team',
    canExportPdf: false,
    canExportExcel: false,
    isBanned: true,
  }),
]

const renderPanel = (
  overrides: Partial<Parameters<typeof DevDataResetPanel>[0]> = {},
) => {
  const props: Parameters<typeof DevDataResetPanel>[0] = {
    status,
    error: '',
    isLoading: false,
    isDialogOpen: false,
    confirmationText: '',
    isResetting: false,
    onDialogOpenChange: noop,
    onConfirmationTextChange: noop,
    onReset: noop,
    ...overrides,
  }

  return render(<DevDataResetPanel {...props} />)
}

afterEach(() => {
  cleanup()
})

describe('SettingsSummaryStats', () => {
  it('shows total, active, admin, and deactivated user counts', () => {
    render(<SettingsSummaryStats users={users} />)

    expect(
      within(screen.getByText('Total users').closest('div')!).getByText('3'),
    ).toBeTruthy()
    expect(
      within(screen.getByText('Active users').closest('div')!).getByText('2'),
    ).toBeTruthy()
    expect(
      within(screen.getByText('Admins').closest('div')!).getByText('1'),
    ).toBeTruthy()
    expect(
      within(screen.getByText('Deactivated').closest('div')!).getByText('1'),
    ).toBeTruthy()
  })
})

describe('settings user helpers', () => {
  it('filters by search, role, team, and status', () => {
    expect(
      filterUsers(users, {
        ...defaultFilters,
        search: 'eric',
      }).map((user) => user.id),
    ).toEqual(['editor-1'])

    expect(
      filterUsers(users, {
        ...defaultFilters,
        search: 'viewer@taxdocs',
      }).map((user) => user.id),
    ).toEqual(['viewer-1'])

    expect(
      filterUsers(users, {
        ...defaultFilters,
        role: 'admin',
      }).map((user) => user.id),
    ).toEqual(['admin-1'])

    expect(
      filterUsers(users, {
        ...defaultFilters,
        team: 'ar_team',
      }).map((user) => user.id),
    ).toEqual(['viewer-1'])

    expect(
      filterUsers(users, {
        ...defaultFilters,
        status: 'deactivated',
      }).map((user) => user.id),
    ).toEqual(['viewer-1'])
  })

  it('paginates filtered users at 25 per page and supports resetting to page 1', () => {
    const manyUsers = Array.from({ length: 28 }, (_, index) =>
      createUser({
        id: `user-${index + 1}`,
        email: `user-${index + 1}@taxdocs.com`,
        name: `User ${index + 1}`,
      }),
    )

    const firstPage = paginateUsers(manyUsers, 1)
    const secondPage = paginateUsers(manyUsers, 2)
    const resetPage = paginateUsers(manyUsers.slice(0, 4), 1)

    expect(firstPage.users).toHaveLength(25)
    expect(firstPage.start).toBe(1)
    expect(firstPage.end).toBe(25)
    expect(firstPage.totalPages).toBe(2)
    expect(secondPage.users).toHaveLength(3)
    expect(resetPage.currentPage).toBe(1)
    expect(resetPage.users).toHaveLength(4)
  })
})

describe('SelectedUserInspector', () => {
  it('saves the selected user id, role, team, and export flags', () => {
    const selectedUser = users[0]
    const onSave = vi.fn()
    const draft: UserUpdateInput = {
      ...getSelectedUserDraft(selectedUser),
      role: 'editor',
      team: 'tax_team',
      canExportPdf: true,
      canExportExcel: false,
    }
    const handleSave = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      onSave(draft)
    }

    render(
      <SelectedUserInspector
        user={selectedUser}
        draft={draft}
        error=""
        isSubmitting={false}
        currentUserId="another-user"
        roles={userRoles}
        teams={teamOptions}
        onDraftChange={noop}
        onSave={handleSave}
        onResetPassword={noop}
        onStatusChange={noop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(onSave).toHaveBeenCalledWith({
      userId: 'admin-1',
      role: 'editor',
      team: 'tax_team',
      canExportPdf: true,
      canExportExcel: false,
    })
  })
})

describe('DevDataResetPanel', () => {
  it('is omitted when the settings route has no dev reset status', () => {
    const Harness = ({ value }: { value: DevDataResetStatus | null }) =>
      value ? (
        <DevDataResetPanel
          status={value}
          error=""
          isLoading={false}
          isDialogOpen={false}
          confirmationText=""
          isResetting={false}
          onDialogOpenChange={noop}
          onConfirmationTextChange={noop}
          onReset={noop}
        />
      ) : null

    render(<Harness value={null} />)

    expect(screen.queryByText('Development data')).toBeNull()
  })

  it('shows the current dev stage and table counts', () => {
    renderPanel()

    expect(screen.getByText('Development data')).toBeTruthy()
    expect(screen.getByText('dev-app')).toBeTruthy()
    expect(screen.getByText('Intake files')).toBeTruthy()
    expect(screen.getByText('Document results')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('requires confirmation text before calling reset', () => {
    const onConfirmationTextChange = vi.fn()
    const onReset = vi.fn()
    const { rerender } = renderPanel({
      isDialogOpen: true,
      onConfirmationTextChange,
      onReset,
    })

    const confirmButton = screen.getByRole('button', {
      name: /clear data/i,
    })
    expect(confirmButton.disabled).toBe(true)

    fireEvent.change(
      screen.getByLabelText(/type clear dev data to confirm/i),
      {
        target: { value: 'CLEAR DEV DATA' },
      },
    )
    expect(onConfirmationTextChange).toHaveBeenCalledWith('CLEAR DEV DATA')

    rerender(
      <DevDataResetPanel
        status={status}
        error=""
        isLoading={false}
        isDialogOpen
        confirmationText="CLEAR DEV DATA"
        isResetting={false}
        onDialogOpenChange={noop}
        onConfirmationTextChange={onConfirmationTextChange}
        onReset={onReset}
      />,
    )

    const enabledConfirmButton = screen.getByRole('button', {
      name: /clear data/i,
    })
    expect(enabledConfirmButton.disabled).toBe(false)

    fireEvent.click(enabledConfirmButton)

    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
