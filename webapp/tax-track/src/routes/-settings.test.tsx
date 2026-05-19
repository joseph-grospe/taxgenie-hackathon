/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'

import type { DevDataResetStatus, SettingsUserFilters } from '@/routes/settings'
import type { ManagedUser, UserUpdateInput } from '@/lib/users-module'
import {
  DevDataResetPanel,
  SelectedUserInspector,
  SettingsSummaryStats,
  canResendVerificationEmail,
  createUserSheetLayoutClasses,
  createUsersCsv,
  filterUsers,
  getSelectedUserDraft,
  paginateUsers,
} from '@/routes/settings'
import { assignableUserRoles, teamOptions } from '@/lib/user-roles'

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
  emailVerified: overrides.emailVerified ?? true,
  mustChangePassword: overrides.mustChangePassword ?? false,
  isBanned: overrides.isBanned ?? false,
  isDeleted: overrides.isDeleted ?? false,
  createdAt: overrides.createdAt ?? '2025-05-01T09:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2025-05-02T09:00:00.000Z',
  deletedAt: overrides.deletedAt,
  deletedByUserId: overrides.deletedByUserId,
  deletedReason: overrides.deletedReason,
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

  it('counts the super admin with admins', () => {
    render(
      <SettingsSummaryStats
        users={[
          createUser({
            id: 'super-admin-1',
            role: 'super_admin',
          }),
          ...users,
        ]}
      />,
    )

    expect(
      within(screen.getByText('Admins').closest('div')!).getByText('2'),
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

    expect(
      filterUsers(
        [
          createUser({
            id: 'super-admin-1',
            role: 'super_admin',
          }),
          ...users,
        ],
        {
          ...defaultFilters,
          role: 'super_admin',
        },
      ).map((user) => user.id),
    ).toEqual(['super-admin-1'])
  })

  it('paginates filtered users at 10 per page and supports resetting to page 1', () => {
    const manyUsers = Array.from({ length: 28 }, (_, index) =>
      createUser({
        id: `user-${index + 1}`,
        email: `user-${index + 1}@taxdocs.com`,
        name: `User ${index + 1}`,
      }),
    )

    const firstPage = paginateUsers(manyUsers, 1)
    const secondPage = paginateUsers(manyUsers, 2)
    const thirdPage = paginateUsers(manyUsers, 3)
    const resetPage = paginateUsers(manyUsers.slice(0, 4), 1)

    expect(firstPage.users).toHaveLength(10)
    expect(firstPage.users.map((user) => user.id)).toEqual([
      'user-1',
      'user-2',
      'user-3',
      'user-4',
      'user-5',
      'user-6',
      'user-7',
      'user-8',
      'user-9',
      'user-10',
    ])
    expect(firstPage.start).toBe(1)
    expect(firstPage.end).toBe(10)
    expect(firstPage.totalPages).toBe(3)
    expect(secondPage.users).toHaveLength(10)
    expect(secondPage.users.map((user) => user.id)).toEqual([
      'user-11',
      'user-12',
      'user-13',
      'user-14',
      'user-15',
      'user-16',
      'user-17',
      'user-18',
      'user-19',
      'user-20',
    ])
    expect(secondPage.start).toBe(11)
    expect(secondPage.end).toBe(20)
    expect(thirdPage.users).toHaveLength(8)
    expect(thirdPage.users.map((user) => user.id)).toEqual([
      'user-21',
      'user-22',
      'user-23',
      'user-24',
      'user-25',
      'user-26',
      'user-27',
      'user-28',
    ])
    expect(thirdPage.start).toBe(21)
    expect(thirdPage.end).toBe(28)
    expect(resetPage.currentPage).toBe(1)
    expect(resetPage.users).toHaveLength(4)
  })

  it('includes email verification state in user CSV exports', () => {
    const csv = createUsersCsv([
      createUser({ id: 'verified-1', emailVerified: true }),
      createUser({ id: 'pending-1', emailVerified: false }),
      createUser({ id: 'super-admin-1', role: 'super_admin' }),
    ])

    expect(csv.split('\n')[0]).toContain('Email verified')
    expect(csv).toContain('Super Admin')
    expect(csv).toContain('Yes')
    expect(csv).toContain('No')
  })

  it('omits role changes from the super admin draft', () => {
    expect(
      getSelectedUserDraft(
        createUser({
          id: 'super-admin-1',
          role: 'super_admin',
        }),
      ),
    ).toMatchObject({
      userId: 'super-admin-1',
      role: undefined,
    })
  })

  it('allows verification resend only for active pending users', () => {
    expect(
      canResendVerificationEmail(
        createUser({ emailVerified: false, isBanned: false }),
      ),
    ).toBe(true)
    expect(
      canResendVerificationEmail(
        createUser({ emailVerified: true, isBanned: false }),
      ),
    ).toBe(false)
    expect(
      canResendVerificationEmail(
        createUser({ emailVerified: false, isBanned: true }),
      ),
    ).toBe(false)
    expect(
      canResendVerificationEmail(
        createUser({ emailVerified: false, isBanned: true, isDeleted: true }),
      ),
    ).toBe(false)
  })

  it('keeps create-user sheet actions visible while fields scroll', () => {
    expect(createUserSheetLayoutClasses.form).toContain('min-h-0')
    expect(createUserSheetLayoutClasses.form).toContain('flex-1')
    expect(createUserSheetLayoutClasses.body).toContain('min-h-0')
    expect(createUserSheetLayoutClasses.body).toContain('flex-1')
    expect(createUserSheetLayoutClasses.body).toContain('overflow-y-auto')
    expect(createUserSheetLayoutClasses.footer).toContain('shrink-0')
    expect(createUserSheetLayoutClasses.footer).toContain('border-t')
    expect(createUserSheetLayoutClasses.footer).not.toContain('mt-auto')
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
        canManageUserStatus
        roles={assignableUserRoles}
        teams={teamOptions}
        onDraftChange={noop}
        onSave={handleSave}
        onResetPassword={noop}
        onResendVerification={noop}
        onStatusChange={noop}
        onDeleteUser={noop}
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

  it('shows a resend verification action for active pending users', () => {
    const selectedUser = createUser({
      emailVerified: false,
      isBanned: false,
    })
    const onResendVerification = vi.fn()

    render(
      <SelectedUserInspector
        user={selectedUser}
        draft={getSelectedUserDraft(selectedUser)}
        error=""
        isSubmitting={false}
        currentUserId="another-user"
        canManageUserStatus
        roles={assignableUserRoles}
        teams={teamOptions}
        onDraftChange={noop}
        onSave={(event) => event.preventDefault()}
        onResetPassword={noop}
        onResendVerification={onResendVerification}
        onStatusChange={noop}
        onDeleteUser={noop}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /resend verification/i }),
    )

    expect(onResendVerification).toHaveBeenCalledWith(selectedUser)
  })

  it('closes the status confirmation before rendering the opposite action', async () => {
    const activeUser = createUser({
      id: 'status-user',
      name: 'Status User',
      isBanned: false,
    })
    const deactivatedUser = createUser({
      id: 'status-user',
      name: 'Status User',
      isBanned: true,
    })
    const onStatusChange = vi.fn()
    const renderInspector = (user: ManagedUser) => (
      <SelectedUserInspector
        user={user}
        draft={getSelectedUserDraft(user)}
        error=""
        isSubmitting={false}
        currentUserId="another-user"
        canManageUserStatus
        roles={assignableUserRoles}
        teams={teamOptions}
        onDraftChange={noop}
        onSave={(event) => event.preventDefault()}
        onResetPassword={noop}
        onResendVerification={noop}
        onStatusChange={onStatusChange}
        onDeleteUser={noop}
      />
    )

    const { rerender } = render(renderInspector(activeUser))

    fireEvent.click(screen.getByRole('button', { name: /deactivate user/i }))
    expect(await screen.findByText('Deactivate user?')).toBeTruthy()
    const deactivateButtons = screen.getAllByRole('button', {
      name: /deactivate user/i,
    })
    fireEvent.click(deactivateButtons.at(-1)!)
    rerender(renderInspector(deactivatedUser))

    expect(onStatusChange).toHaveBeenCalledWith('status-user', 'deactivate')
    expect(screen.queryByText('Reactivate user?')).toBeNull()
    expect(
      screen.queryByText(/This restores access for Status User/i),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: /reactivate user/i }),
    ).toBeTruthy()
  })

  it('confirms before soft deleting a selected user', async () => {
    const selectedUser = createUser({
      id: 'delete-user',
      name: 'Delete User',
    })
    const onDeleteUser = vi.fn()

    render(
      <SelectedUserInspector
        user={selectedUser}
        draft={getSelectedUserDraft(selectedUser)}
        error=""
        isSubmitting={false}
        currentUserId="another-user"
        canManageUserStatus
        roles={assignableUserRoles}
        teams={teamOptions}
        onDraftChange={noop}
        onSave={(event) => event.preventDefault()}
        onResetPassword={noop}
        onResendVerification={noop}
        onStatusChange={noop}
        onDeleteUser={onDeleteUser}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /delete user/i }))
    expect(await screen.findByText('Delete user?')).toBeTruthy()

    const deleteButtons = screen.getAllByRole('button', {
      name: /delete user/i,
    })
    fireEvent.click(deleteButtons.at(-1)!)

    expect(onDeleteUser).toHaveBeenCalledWith('delete-user')
  })

  it('disables self deletion', () => {
    const selectedUser = createUser({
      id: 'current-admin',
      name: 'Current Admin',
    })
    const onDeleteUser = vi.fn()

    render(
      <SelectedUserInspector
        user={selectedUser}
        draft={getSelectedUserDraft(selectedUser)}
        error=""
        isSubmitting={false}
        currentUserId="current-admin"
        canManageUserStatus
        roles={assignableUserRoles}
        teams={teamOptions}
        onDraftChange={noop}
        onSave={(event) => event.preventDefault()}
        onResetPassword={noop}
        onResendVerification={noop}
        onStatusChange={noop}
        onDeleteUser={onDeleteUser}
      />,
    )

    const deleteButton = screen.getByRole('button', {
      name: /delete user/i,
    })

    expect(deleteButton.disabled).toBe(true)
    expect(onDeleteUser).not.toHaveBeenCalled()
  })

  it('disables status actions for non-super-admin managers', () => {
    const selectedUser = createUser({
      id: 'managed-user',
      name: 'Managed User',
    })
    const onStatusChange = vi.fn()

    render(
      <SelectedUserInspector
        user={selectedUser}
        draft={getSelectedUserDraft(selectedUser)}
        error=""
        isSubmitting={false}
        currentUserId="another-user"
        canManageUserStatus={false}
        roles={assignableUserRoles}
        teams={teamOptions}
        onDraftChange={noop}
        onSave={(event) => event.preventDefault()}
        onResetPassword={noop}
        onResendVerification={noop}
        onStatusChange={onStatusChange}
        onDeleteUser={noop}
      />,
    )

    const deactivateButton = screen.getByRole('button', {
      name: /deactivate user/i,
    })

    expect(deactivateButton.disabled).toBe(true)
    expect(
      screen.getByText(/only the super admin can deactivate or reactivate/i),
    ).toBeTruthy()
    expect(onStatusChange).not.toHaveBeenCalled()
  })

  it('protects the super admin role and destructive actions', () => {
    const selectedUser = createUser({
      id: 'super-admin-1',
      name: 'Seed Admin',
      role: 'super_admin',
    })
    const onStatusChange = vi.fn()
    const onDeleteUser = vi.fn()
    const onResetPassword = vi.fn()

    render(
      <SelectedUserInspector
        user={selectedUser}
        draft={getSelectedUserDraft(selectedUser)}
        error=""
        isSubmitting={false}
        currentUserId="another-user"
        canManageUserStatus
        roles={assignableUserRoles}
        teams={teamOptions}
        onDraftChange={noop}
        onSave={(event) => event.preventDefault()}
        onResetPassword={onResetPassword}
        onResendVerification={noop}
        onStatusChange={onStatusChange}
        onDeleteUser={onDeleteUser}
      />,
    )

    expect(screen.getByText('Super Admin')).toBeTruthy()
    expect(screen.getByText('Protected')).toBeTruthy()

    const deactivateButton = screen.getByRole('button', {
      name: /deactivate user/i,
    })
    const deleteButton = screen.getByRole('button', {
      name: /delete user/i,
    })
    const resetPasswordButton = screen.getByRole('button', {
      name: /reset password/i,
    })

    expect(deactivateButton.disabled).toBe(true)
    expect(deleteButton.disabled).toBe(true)
    expect(resetPasswordButton.disabled).toBe(true)
    expect(
      screen.getByText(/only the super admin can reset the super admin/i),
    ).toBeTruthy()
    expect(onStatusChange).not.toHaveBeenCalled()
    expect(onDeleteUser).not.toHaveBeenCalled()
    expect(onResetPassword).not.toHaveBeenCalled()
  })

  it('allows the super admin to reset their own password', () => {
    const selectedUser = createUser({
      id: 'super-admin-1',
      name: 'Seed Admin',
      role: 'super_admin',
    })
    const onResetPassword = vi.fn()

    render(
      <SelectedUserInspector
        user={selectedUser}
        draft={getSelectedUserDraft(selectedUser)}
        error=""
        isSubmitting={false}
        currentUserId="super-admin-1"
        canManageUserStatus
        roles={assignableUserRoles}
        teams={teamOptions}
        onDraftChange={noop}
        onSave={(event) => event.preventDefault()}
        onResetPassword={onResetPassword}
        onResendVerification={noop}
        onStatusChange={noop}
        onDeleteUser={noop}
      />,
    )

    const resetPasswordButton = screen.getByRole('button', {
      name: /reset password/i,
    })

    expect(resetPasswordButton.disabled).toBe(false)
    fireEvent.click(resetPasswordButton)
    expect(onResetPassword).toHaveBeenCalledWith(selectedUser)
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

    fireEvent.change(screen.getByLabelText(/type clear dev data to confirm/i), {
      target: { value: 'CLEAR DEV DATA' },
    })
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
