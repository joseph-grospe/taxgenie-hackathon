import { createFileRoute } from '@tanstack/react-router'
import {
  IconChevronLeft,
  IconChevronRight,
  IconDatabaseOff,
  IconDownload,
  IconFilePlus,
  IconFileSpreadsheet,
  IconFileTypePdf,
  IconLock,
  IconMailCheck,
  IconMailExclamation,
  IconMailForward,
  IconSearch,
  IconShield,
  IconTrash,
  IconUserCheck,
  IconUserOff,
  IconUsers,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { FormEvent } from 'react'

import type {
  ManagedUser,
  UserCreateInput,
  UserResetPasswordInput,
  UserUpdateInput,
} from '@/lib/users-module'
import type { AssignableUserRole, Team, UserRole } from '@/lib/user-roles'

import { AppShell } from '@/components/app-shell'
import { SettingsTour } from '@/components/product-tour'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { PasswordInput } from '@/components/password-input'
import { SettingsUserMoreActions } from '@/components/settings-user-more-actions'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { authClient } from '@/lib/auth-client'
import {
  isAdmin,
  isSuperAdmin,
  parseSessionContext,
  roleAccessMatrix,
} from '@/lib/access-control'
import {
  SETTINGS_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import {
  assignableUserRoles,
  teamLabels,
  teamOptions,
  userRoles,
} from '@/lib/user-roles'
import {
  passwordPolicy,
  userCreateSchema,
  userResetPasswordSchema,
  userUpdateSchema,
} from '@/lib/users-module'
import { cn } from '@/lib/utils'

const settingsUsersPerPage = 10
const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'
const SETTINGS_SELECT_CONTENT_PROPS = {
  align: 'start',
  alignItemWithTrigger: false,
  className:
    'min-w-[var(--anchor-width)] rounded-md border border-border/70 bg-background',
} as const
const SETTINGS_SELECT_TRIGGER_CLASS = 'rounded-md bg-background'
const SETTINGS_SELECT_ITEM_CLASS =
  'min-h-8 rounded-none bg-background py-2 pl-3 pr-9 text-sm hover:bg-background focus:bg-background focus:text-foreground data-[highlighted]:bg-background data-[selected]:bg-background'
export const createUserSheetLayoutClasses = {
  form: 'flex min-h-0 flex-1 flex-col',
  body: 'min-h-0 flex-1 overflow-y-auto px-4 py-4',
  footer: 'shrink-0 border-t p-4',
} as const
export const selectedUserSheetLayoutClasses = {
  content:
    'data-[side=right]:w-full data-[side=right]:sm:max-w-md border-border/70',
  form: 'flex min-h-0 flex-1 flex-col',
  body: 'min-h-0 flex-1 overflow-y-auto px-4 py-4',
  footer: 'shrink-0 border-t p-4',
  actions: 'flex flex-col gap-2',
  secondaryActions: 'grid gap-2 sm:grid-cols-2',
  primaryAction: 'w-full',
  secondaryAction: 'w-full',
  moreActionWithResend: 'sm:col-span-2',
  menuContent: 'w-(--anchor-width) min-w-56',
  notes: 'flex flex-col gap-1',
} as const

const defaultCreateForm: UserCreateInput = {
  email: '',
  name: '',
  password: '',
  role: assignableUserRoles[2],
  team: 'other',
  canExportPdf: false,
  canExportExcel: false,
}

const defaultEditForm: UserUpdateInput = {
  userId: '',
  role: assignableUserRoles[2],
  team: 'other',
  canExportPdf: false,
  canExportExcel: false,
}

const defaultResetForm: UserResetPasswordInput = {
  userId: '',
  newPassword: '',
}

type ApiPayload<T> = {
  error?: string
  user?: T
  users?: Array<T>
  notificationEmailSent?: boolean
  verificationEmailSent?: boolean
  warning?: string
}

export type DevDataResetStatus = {
  available: boolean
  stage: string
  counts: Record<string, number>
}

type DevDataResetPayload = Partial<DevDataResetStatus> & {
  error?: string
}

type RoleFilter = UserRole | 'all_roles'
type TeamFilter = Team | 'all_teams'
type StatusFilter = 'all_status' | 'active' | 'deactivated'

export type SettingsUserFilters = {
  search: string
  role: RoleFilter
  team: TeamFilter
  status: StatusFilter
}

export type SettingsSummaryCounts = {
  total: number
  active: number
  admins: number
  deactivated: number
}

export type PaginatedUsers = {
  users: Array<ManagedUser>
  totalPages: number
  currentPage: number
  start: number
  end: number
}

const defaultFilters: SettingsUserFilters = {
  search: '',
  role: 'all_roles',
  team: 'all_teams',
  status: 'all_status',
}

const devDataResetConfirmation = 'CLEAR DEV DATA'

const devDataResetTableLabels: Partial<Record<string, string>> = {
  reconciliation_results: 'Reconciliation results',
  sales_report_run_batches: 'Sales report batch selections',
  sales_report_runs: 'Sales report reconciliation runs',
  sales_report_rows: 'Sales report rows',
  sales_report_versions: 'Sales report versions',
  sales_reports: 'Sales reports',
  certificate_merge_job_outputs: 'Merge job outputs',
  certificate_merge_job_inputs: 'Merge job inputs',
  certificate_merge_job_batches: 'Merge job batch selections',
  certificate_merge_jobs: 'Merge jobs',
  certificate_signed_artifacts: 'Signed certificate artifacts',
  worker_job_steps: 'Worker job steps',
  worker_jobs: 'Worker jobs',
  worker_idempotency: 'Worker idempotency',
  document_results: 'Document results',
  intake_files: 'Intake files',
  intake_batches: 'Intake batches',
}

const roleAccessAreas = [
  { key: 'settings', label: 'Settings' },
  { key: 'users', label: 'Users' },
  { key: 'upload', label: 'Upload' },
  { key: 'reports', label: 'Reports' },
  { key: 'audit', label: 'Audit' },
] as const

const parseApiPayload = async <T,>(
  response: Response,
): Promise<ApiPayload<T>> => {
  const payload = await response.json().catch(() => ({}))
  return payload as ApiPayload<T>
}

const callUsersApi = async <T,>(
  path: string,
  init?: Omit<RequestInit, 'body'> & { body?: unknown },
): Promise<ApiPayload<T>> => {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
    },
    ...init,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })

  const payload = await parseApiPayload<T>(response)
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed')
  }

  return payload
}

const formatTeam = (team: Team) => teamLabels[team]

const formatRole = (role: UserRole) =>
  role === 'super_admin'
    ? 'Super Admin'
    : role.charAt(0).toUpperCase() + role.slice(1)

const roleSelectOptions = userRoles.map((role) => ({
  value: role,
  label: formatRole(role),
}))

const assignableRoleSelectOptions = assignableUserRoles.map((role) => ({
  value: role,
  label: formatRole(role),
}))

const teamSelectOptions = teamOptions.map((team) => ({
  value: team,
  label: formatTeam(team),
}))

const roleFilterOptions: Array<{ value: RoleFilter; label: string }> = [
  { value: 'all_roles', label: 'All' },
  ...roleSelectOptions,
]

const teamFilterOptions: Array<{ value: TeamFilter; label: string }> = [
  { value: 'all_teams', label: 'All' },
  ...teamSelectOptions,
]

const statusFilterOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all_status', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
]

const getOptionLabel = <T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T,
) => options.find((option) => option.value === value)?.label ?? value

const getRoleFilterLabel = (value: RoleFilter) =>
  getOptionLabel(roleFilterOptions, value)

const getTeamFilterLabel = (value: TeamFilter) =>
  getOptionLabel(teamFilterOptions, value)

const getStatusFilterLabel = (value: StatusFilter) =>
  getOptionLabel(statusFilterOptions, value)

const formatDevDataResetLabel = (tableName: string) =>
  devDataResetTableLabels[tableName] ??
  tableName
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')

export const getUserInitials = (user: Pick<ManagedUser, 'name' | 'email'>) => {
  const source = user.name.trim() || user.email.trim()
  if (!source) {
    return '--'
  }

  const words = source.replace(/@.*/, '').split(/\s+/).filter(Boolean)

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
}

export const getUserUpdatedLabel = (
  user: Pick<ManagedUser, 'createdAt' | 'updatedAt'>,
) => {
  const timestamp = user.updatedAt ?? user.createdAt
  if (!timestamp) {
    return '—'
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export const getSettingsSummaryCounts = (
  users: Array<ManagedUser>,
): SettingsSummaryCounts => ({
  total: users.length,
  active: users.filter((user) => !user.isBanned).length,
  admins: users.filter((user) => isAdmin(user.role)).length,
  deactivated: users.filter((user) => user.isBanned).length,
})

export const filterUsers = (
  users: Array<ManagedUser>,
  filters: SettingsUserFilters,
) => {
  const query = filters.search.trim().toLowerCase()

  return users.filter((user) => {
    const matchesSearch =
      query.length === 0 ||
      user.name.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query)
    const matchesRole =
      filters.role === 'all_roles' || user.role === filters.role
    const matchesTeam =
      filters.team === 'all_teams' || user.team === filters.team
    const matchesStatus =
      filters.status === 'all_status' ||
      (filters.status === 'active' && !user.isBanned) ||
      (filters.status === 'deactivated' && user.isBanned)

    return matchesSearch && matchesRole && matchesTeam && matchesStatus
  })
}

export const paginateUsers = (
  users: Array<ManagedUser>,
  page: number,
  pageSize = settingsUsersPerPage,
): PaginatedUsers => {
  const totalPages = Math.max(1, Math.ceil(users.length / pageSize))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const pageUsers = users.slice(startIndex, startIndex + pageSize)

  return {
    users: pageUsers,
    totalPages,
    currentPage,
    start: users.length === 0 ? 0 : startIndex + 1,
    end: startIndex + pageUsers.length,
  }
}

export const getPaginationPages = (currentPage: number, totalPages: number) => {
  const visibleCount = Math.min(totalPages, 5)
  const firstPage = Math.min(
    Math.max(1, currentPage - Math.floor(visibleCount / 2)),
    Math.max(1, totalPages - visibleCount + 1),
  )

  return Array.from({ length: visibleCount }, (_, index) => firstPage + index)
}

export const getSelectedUserDraft = (user: ManagedUser): UserUpdateInput => ({
  userId: user.id,
  role: user.role === 'super_admin' ? undefined : user.role,
  team: user.team,
  canExportPdf: user.canExportPdf,
  canExportExcel: user.canExportExcel,
})

export const canResendVerificationEmail = (
  user: Pick<ManagedUser, 'emailVerified' | 'isBanned' | 'isDeleted'>,
) => !user.emailVerified && !user.isBanned && !user.isDeleted

const escapeCsvValue = (value: string | number | boolean) => {
  const text = String(value)
  if (!/[",\n]/.test(text)) {
    return text
  }

  return `"${text.replaceAll('"', '""')}"`
}

export const createUsersCsv = (users: Array<ManagedUser>) => {
  const rows = [
    [
      'Name',
      'Email',
      'Role',
      'Team',
      'Status',
      'Email verified',
      'Can export PDF',
      'Can export Excel',
      'Updated',
    ],
    ...users.map((user) => [
      user.name,
      user.email,
      formatRole(user.role),
      formatTeam(user.team),
      user.isBanned ? 'Deactivated' : 'Active',
      user.emailVerified ? 'Yes' : 'No',
      user.canExportPdf ? 'Yes' : 'No',
      user.canExportExcel ? 'Yes' : 'No',
      getUserUpdatedLabel(user),
    ]),
  ]

  return rows
    .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
    .join('\n')
}

export function SettingsSummaryStats({ users }: { users: Array<ManagedUser> }) {
  const counts = getSettingsSummaryCounts(users)
  const stats = [
    {
      label: 'Total users',
      value: counts.total,
      icon: IconUsers,
      tone: 'default',
    },
    {
      label: 'Active users',
      value: counts.active,
      icon: IconUserCheck,
      tone: 'success',
    },
    {
      label: 'Admins',
      value: counts.admins,
      icon: IconShield,
      tone: 'default',
    },
    {
      label: 'Deactivated',
      value: counts.deactivated,
      icon: IconUserOff,
      tone: 'danger',
    },
  ] as const

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} size="sm" className={PANEL_CARD_CLASS}>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <stat.icon className="size-4" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-xs text-muted-foreground">
                {stat.label}
              </p>
              <p
                className={cn(
                  'text-xl font-semibold leading-none',
                  stat.tone === 'success' && 'text-primary',
                  stat.tone === 'danger' && 'text-destructive',
                )}
              >
                {stat.value.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function UserStatusBadge({ isBanned }: { isBanned: boolean }) {
  return (
    <Badge
      variant={isBanned ? 'destructive' : 'outline'}
      className={
        isBanned
          ? undefined
          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
      }
    >
      {isBanned ? 'Deactivated' : 'Active'}
    </Badge>
  )
}

function UserVerificationBadge({ emailVerified }: { emailVerified: boolean }) {
  return (
    <Badge variant={emailVerified ? 'outline' : 'secondary'}>
      {emailVerified ? (
        <IconMailCheck data-icon="inline-start" />
      ) : (
        <IconMailExclamation data-icon="inline-start" />
      )}
      {emailVerified ? 'Verified' : 'Pending'}
    </Badge>
  )
}

function ExportPermissionIcons({ user }: { user: ManagedUser }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      <Tooltip>
        <TooltipTrigger>
          <span
            className={cn(
              'flex flex-col items-center gap-0.5 text-[10px] leading-none',
              user.canExportPdf && 'text-foreground',
            )}
          >
            <IconFileTypePdf />
            <span>PDF</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {user.canExportPdf ? 'PDF export allowed' : 'PDF export blocked'}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <span
            className={cn(
              'flex flex-col items-center gap-0.5 text-[10px] leading-none',
              user.canExportExcel && 'text-foreground',
            )}
          >
            <IconFileSpreadsheet />
            <span>XLSX</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {user.canExportExcel
            ? 'Excel export allowed'
            : 'Excel export blocked'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function UserIdentity({
  user,
  size = 'default',
}: {
  user: ManagedUser
  size?: 'default' | 'lg'
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar size={size}>
        <AvatarFallback>{getUserInitials(user)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
    </div>
  )
}

type SelectedUserInspectorProps = {
  user: ManagedUser | null
  draft: UserUpdateInput
  error: string
  isSubmitting: boolean
  currentUserId: string
  canManageUserStatus: boolean
  roles: ReadonlyArray<AssignableUserRole>
  teams: ReadonlyArray<Team>
  onDraftChange: (draft: UserUpdateInput) => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
  onResetPassword: (user: ManagedUser) => void
  onResendVerification: (user: ManagedUser) => void
  onStatusChange: (userId: string, action: 'activate' | 'deactivate') => void
  onDeleteUser: (userId: string) => void
}

export function SelectedUserInspector({
  user,
  draft,
  error,
  isSubmitting,
  currentUserId,
  canManageUserStatus,
  roles,
  teams,
  onDraftChange,
  onSave,
  onResetPassword,
  onResendVerification,
  onStatusChange,
  onDeleteUser,
}: SelectedUserInspectorProps) {
  if (!user) {
    return (
      <div className="flex min-h-80 flex-col gap-3 p-4">
        <div
          className={cn(
            'flex flex-1 items-center justify-center rounded-lg border border-dashed bg-muted/10 p-6 text-center text-xs text-muted-foreground',
            PANEL_BORDER_CLASS,
          )}
        >
          Select a user from the table to manage their access.
        </div>
      </div>
    )
  }

  const isSelf = user.id === currentUserId
  const isProtectedSuperAdmin = isSuperAdmin(user.role)
  const statusAction = user.isBanned ? 'activate' : 'deactivate'
  const statusLabel = user.isBanned ? 'Reactivate user' : 'Deactivate user'
  const StatusIcon = user.isBanned ? IconUserCheck : IconUserOff
  const disableSelfDeactivation = isSelf && statusAction === 'deactivate'
  const statusDisabledReason = isProtectedSuperAdmin
    ? `The super admin account cannot be ${
        user.isBanned ? 'reactivated' : 'deactivated'
      }.`
    : !canManageUserStatus
      ? 'Only the super admin can deactivate or reactivate users.'
      : disableSelfDeactivation
        ? 'You cannot deactivate your own account.'
        : ''
  const deleteDisabledReason = isProtectedSuperAdmin
    ? 'The super admin account cannot be deleted.'
    : isSelf
      ? 'You cannot delete your own account.'
      : ''
  const resetPasswordDisabledReason =
    isProtectedSuperAdmin && !isSelf
      ? 'Only the super admin can reset the super admin password.'
      : ''
  const footerNote = isProtectedSuperAdmin
    ? 'The super admin account cannot be deactivated, reactivated, or deleted.'
    : isSelf
      ? 'You cannot deactivate or delete your own account.'
      : !canManageUserStatus
        ? 'Only the super admin can deactivate or reactivate users.'
        : ''
  const selectedRoleValue = isProtectedSuperAdmin
    ? undefined
    : (draft.role ?? (user.role as AssignableUserRole))
  const canResendVerification = canResendVerificationEmail(user)

  return (
    <form
      data-testid="selected-user-inspector-form"
      onSubmit={onSave}
      className={selectedUserSheetLayoutClasses.form}
    >
      <div className={selectedUserSheetLayoutClasses.body}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap justify-end gap-2">
            <UserStatusBadge isBanned={user.isBanned} />
            <UserVerificationBadge emailVerified={user.emailVerified} />
          </div>

          <div
            className={cn(
              'rounded-lg border bg-muted/10 p-3',
              PANEL_BORDER_CLASS,
            )}
          >
            <UserIdentity user={user} size="lg" />
          </div>

          {error ? (
            <FieldDescription className="text-destructive">
              {error}
            </FieldDescription>
          ) : null}

          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="inspector-role" className="text-xs">
                Role
              </FieldLabel>
              {isProtectedSuperAdmin ? (
                <div
                  id="inspector-role"
                  className={cn(
                    'flex min-h-8 items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-1.5',
                    PANEL_BORDER_CLASS,
                  )}
                >
                  <span className="text-sm font-medium">
                    {formatRole(user.role)}
                  </span>
                  <Badge variant="outline">Protected</Badge>
                </div>
              ) : (
                <Select
                  items={assignableRoleSelectOptions}
                  value={selectedRoleValue}
                  onValueChange={(value) =>
                    onDraftChange({
                      ...draft,
                      role: value as AssignableUserRole,
                    })
                  }
                >
                  <SelectTrigger
                    id="inspector-role"
                    size="sm"
                    className={cn(SETTINGS_SELECT_TRIGGER_CLASS, 'w-full')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent {...SETTINGS_SELECT_CONTENT_PROPS}>
                    <SelectGroup>
                      <SelectLabel>Roles</SelectLabel>
                      {roles.map((role) => (
                        <SelectItem
                          key={role}
                          value={role}
                          className={SETTINGS_SELECT_ITEM_CLASS}
                        >
                          {formatRole(role)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              {isProtectedSuperAdmin ? (
                <FieldDescription className="text-xs">
                  The seeded super admin role is protected.
                </FieldDescription>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="inspector-team" className="text-xs">
                Team
              </FieldLabel>
              <Select
                items={teamSelectOptions}
                value={draft.team}
                onValueChange={(value) =>
                  onDraftChange({
                    ...draft,
                    team: value as Team,
                  })
                }
              >
                <SelectTrigger
                  id="inspector-team"
                  size="sm"
                  className={cn(SETTINGS_SELECT_TRIGGER_CLASS, 'w-full')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent {...SETTINGS_SELECT_CONTENT_PROPS}>
                  <SelectGroup>
                    <SelectLabel>Teams</SelectLabel>
                    {teams.map((team) => (
                      <SelectItem
                        key={team}
                        value={team}
                        className={SETTINGS_SELECT_ITEM_CLASS}
                      >
                        {formatTeam(team)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <div
            className={cn(
              'flex flex-col gap-3 rounded-lg border bg-muted/10 p-3',
              PANEL_BORDER_CLASS,
            )}
          >
            <div className="flex items-center gap-2 text-xs font-medium">
              <span>Export permissions</span>
            </div>
            <Label className="text-xs" htmlFor="inspector-can-export-pdf">
              <span className="flex items-center gap-2">
                <Checkbox
                  id="inspector-can-export-pdf"
                  checked={draft.canExportPdf}
                  onCheckedChange={(value) =>
                    onDraftChange({
                      ...draft,
                      canExportPdf: value === true,
                    })
                  }
                />
                Allow PDF exports
              </span>
            </Label>
            <Label className="text-xs" htmlFor="inspector-can-export-excel">
              <span className="flex items-center gap-2">
                <Checkbox
                  id="inspector-can-export-excel"
                  checked={draft.canExportExcel}
                  onCheckedChange={(value) =>
                    onDraftChange({
                      ...draft,
                      canExportExcel: value === true,
                    })
                  }
                />
                Allow Excel exports
              </span>
            </Label>
          </div>
        </div>
      </div>
      <SheetFooter
        className={cn(
          selectedUserSheetLayoutClasses.footer,
          PANEL_BORDER_CLASS,
        )}
      >
        <div className={selectedUserSheetLayoutClasses.actions}>
          <Button
            type="submit"
            size="sm"
            className={selectedUserSheetLayoutClasses.primaryAction}
            disabled={isSubmitting || !draft.userId}
          >
            {isSubmitting ? 'Saving...' : 'Save changes'}
          </Button>

          <div className={selectedUserSheetLayoutClasses.secondaryActions}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={selectedUserSheetLayoutClasses.secondaryAction}
              onClick={() => onResetPassword(user)}
              disabled={isSubmitting || Boolean(resetPasswordDisabledReason)}
              title={resetPasswordDisabledReason || undefined}
            >
              <IconLock data-icon="inline-start" />
              Reset password
            </Button>

            {canResendVerification ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={selectedUserSheetLayoutClasses.secondaryAction}
                onClick={() => onResendVerification(user)}
                disabled={isSubmitting}
              >
                <IconMailForward data-icon="inline-start" />
                Resend verification
              </Button>
            ) : null}

            <SettingsUserMoreActions
              user={user}
              isSubmitting={isSubmitting}
              triggerClassName={cn(
                selectedUserSheetLayoutClasses.secondaryAction,
                canResendVerification &&
                  selectedUserSheetLayoutClasses.moreActionWithResend,
              )}
              menuContentClassName={selectedUserSheetLayoutClasses.menuContent}
              statusAction={statusAction}
              statusLabel={statusLabel}
              statusIcon={StatusIcon}
              statusDisabledReason={statusDisabledReason}
              deleteDisabledReason={deleteDisabledReason}
              onStatusChange={onStatusChange}
              onDeleteUser={onDeleteUser}
            />
          </div>
        </div>

        {footerNote || resetPasswordDisabledReason ? (
          <div className={selectedUserSheetLayoutClasses.notes}>
            {footerNote ? (
              <p className="text-xs text-muted-foreground">{footerNote}</p>
            ) : null}
            {resetPasswordDisabledReason ? (
              <p className="text-xs text-muted-foreground">
                {resetPasswordDisabledReason}
              </p>
            ) : null}
          </div>
        ) : null}
      </SheetFooter>
    </form>
  )
}

type SelectedUserSheetProps = SelectedUserInspectorProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SelectedUserSheet({
  open,
  onOpenChange,
  ...inspectorProps
}: SelectedUserSheetProps) {
  return (
    <Sheet
      open={open && Boolean(inspectorProps.user)}
      onOpenChange={(nextOpen) => {
        if (!inspectorProps.user && nextOpen) {
          return
        }

        onOpenChange(nextOpen)
      }}
    >
      <SheetContent
        side="right"
        className={selectedUserSheetLayoutClasses.content}
      >
        <SheetHeader className={cn('border-b p-4', PANEL_BORDER_CLASS)}>
          <SheetTitle className="text-sm">Selected user</SheetTitle>
          <SheetDescription className="sr-only">
            Manage the selected user's access.
          </SheetDescription>
        </SheetHeader>
        <SelectedUserInspector {...inspectorProps} />
      </SheetContent>
    </Sheet>
  )
}

export function DevDataResetPanel({
  status,
  error,
  isLoading,
  isDialogOpen,
  confirmationText,
  isResetting,
  onDialogOpenChange,
  onConfirmationTextChange,
  onReset,
}: {
  status: DevDataResetStatus
  error: string
  isLoading: boolean
  isDialogOpen: boolean
  confirmationText: string
  isResetting: boolean
  onDialogOpenChange: (open: boolean) => void
  onConfirmationTextChange: (value: string) => void
  onReset: () => void
}) {
  const canConfirmReset =
    confirmationText.trim() === devDataResetConfirmation && !isResetting
  const countEntries = Object.entries(status.counts)

  return (
    <section className="overflow-hidden rounded-lg border border-destructive/40 bg-card">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <IconDatabaseOff className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Development data</h2>
            <Badge variant="destructive">Dev only</Badge>
            <Badge variant="outline">{status.stage}</Badge>
          </div>
          <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
            Tools and data for non-production use. Clear runtime intake,
            extraction, signing artifact, merge job, and reconciliation rows
            without touching users, reference data, audit logs, or signing
            templates.
          </p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <AlertDialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            onDialogOpenChange(open)
            if (!open) {
              onConfirmationTextChange('')
            }
          }}
        >
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isLoading || isResetting}
              />
            }
          >
            <IconTrash data-icon="inline-start" />
            Clear dev data
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Clear development data?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently clears runtime rows for the current development
                database. Source and result files in S3 are not deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="dev-data-reset-confirmation">
                  Type {devDataResetConfirmation} to confirm
                </FieldLabel>
                <Input
                  id="dev-data-reset-confirmation"
                  value={confirmationText}
                  onChange={(event) =>
                    onConfirmationTextChange(event.target.value)
                  }
                  disabled={isResetting}
                  autoComplete="off"
                />
              </Field>
            </FieldGroup>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isResetting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={!canConfirmReset}
                onClick={() => onReset()}
              >
                {isResetting ? 'Clearing...' : 'Clear data'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Separator className="bg-border/70" />

      <div className="overflow-x-auto">
        <Table className="min-w-[480px] text-xs [&_td]:px-3 [&_td]:py-2 [&_th]:h-8 [&_th]:px-3">
          <TableHeader className="[&_tr]:border-border/60">
            <TableRow className="bg-muted/35 hover:bg-muted/35">
              <TableHead className="bg-muted/35">Runtime table</TableHead>
              <TableHead className="w-28 bg-muted/35 text-right">
                Rows
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child]:border-b-0">
            {countEntries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={2}
                  className="h-24 text-center text-xs text-muted-foreground"
                >
                  No resettable runtime rows found.
                </TableCell>
              </TableRow>
            ) : (
              countEntries.map(([tableName, count]) => (
                <TableRow key={tableName} className="hover:bg-muted/35">
                  <TableCell className="font-medium">
                    {formatDevDataResetLabel(tableName)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">{count.toLocaleString()}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { data: session, isPending } = authClient.useSession()
  const [users, setUsers] = useState<Array<ManagedUser>>([])
  const [filters, setFilters] = useState<SettingsUserFilters>(defaultFilters)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [isSelectedUserSheetOpen, setIsSelectedUserSheetOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isResetOpen, setIsResetOpen] = useState(false)
  const [isCreatePasswordVisible, setIsCreatePasswordVisible] = useState(false)
  const [isResetPasswordVisible, setIsResetPasswordVisible] = useState(false)
  const [createForm, setCreateForm] =
    useState<UserCreateInput>(defaultCreateForm)
  const [editForm, setEditForm] = useState<UserUpdateInput>(defaultEditForm)
  const [resetForm, setResetForm] =
    useState<UserResetPasswordInput>(defaultResetForm)
  const [createError, setCreateError] = useState('')
  const [editError, setEditError] = useState('')
  const [resetError, setResetError] = useState('')
  const [devResetStatus, setDevResetStatus] =
    useState<DevDataResetStatus | null>(null)
  const [devResetError, setDevResetError] = useState('')
  const [isDevResetLoading, setIsDevResetLoading] = useState(false)
  const [isDevResetDialogOpen, setIsDevResetDialogOpen] = useState(false)
  const [devResetConfirmationText, setDevResetConfirmationText] = useState('')
  const [isDevResetting, setIsDevResetting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [tourStartSignal, setTourStartSignal] = useState(0)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current)
      }
    }
  }, [])

  const context = session?.user ? parseSessionContext(session.user) : null
  const sessionUserId = context?.userId ?? ''

  const canManageUsers = context ? isAdmin(context.role) : false
  const canManageUserStatus = context ? isSuperAdmin(context.role) : false
  const roles = useMemo(() => userRoles, [])
  const assignableRoles = useMemo(() => assignableUserRoles, [])
  const teams = useMemo(() => teamOptions, [])
  const filteredUsers = useMemo(
    () => filterUsers(users, filters),
    [filters, users],
  )
  const paginatedUsers = useMemo(
    () => paginateUsers(filteredUsers, currentPage),
    [currentPage, filteredUsers],
  )
  const selectedUser =
    filteredUsers.find((user) => user.id === selectedUserId) ?? null
  const paginationPages = useMemo(
    () =>
      getPaginationPages(paginatedUsers.currentPage, paginatedUsers.totalPages),
    [paginatedUsers.currentPage, paginatedUsers.totalPages],
  )

  const setActionMessage = (message: string) => {
    setFeedback(message)
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current)
    }

    if (message) {
      feedbackTimerRef.current = setTimeout(() => setFeedback(''), 2500)
    }
  }

  const updateFilters = (nextFilters: Partial<SettingsUserFilters>) => {
    setFilters((prev) => ({ ...prev, ...nextFilters }))
    setCurrentPage(1)
  }

  const openSelectedUserSheet = (userId: string) => {
    setSelectedUserId(userId)
    setIsSelectedUserSheetOpen(true)
  }

  const loadUsers = async () => {
    const payload = await callUsersApi<ManagedUser>('/api/users/list')
    setUsers(payload.users ?? [])
  }

  const loadDevResetStatus = useCallback(async () => {
    setIsDevResetLoading(true)
    setDevResetError('')

    try {
      const response = await fetch('/api/dev/data-reset', {
        cache: 'no-store',
      })

      if (response.status === 404) {
        setDevResetStatus(null)
        return
      }

      const payload = (await response
        .json()
        .catch(() => ({}))) as DevDataResetPayload | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Unable to load development data reset status (${response.status}).`,
        )
      }

      if (!payload?.available || !payload.stage || !payload.counts) {
        setDevResetStatus(null)
        return
      }

      setDevResetStatus({
        available: payload.available,
        stage: payload.stage,
        counts: payload.counts,
      })
    } catch (error) {
      setDevResetError(
        error instanceof Error
          ? error.message
          : 'Unable to load development data reset status.',
      )
    } finally {
      setIsDevResetLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isPending) {
      return
    }

    if (!session?.user) {
      setUsers([])
      setIsLoading(false)
      return
    }

    const load = async () => {
      setIsLoading(true)
      setLoadError('')
      try {
        await loadUsers()
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to load managed users.',
        )
      } finally {
        setIsLoading(false)
      }
    }

    void load()
  }, [isPending, sessionUserId])

  useEffect(() => {
    if (isPending || !session?.user || !canManageUsers) {
      setDevResetStatus(null)
      setDevResetError('')
      return
    }

    void loadDevResetStatus()
  }, [canManageUsers, isPending, loadDevResetStatus, sessionUserId])

  useEffect(() => {
    if (!selectedUserId) {
      return
    }

    if (filteredUsers.some((user) => user.id === selectedUserId)) {
      return
    }

    setSelectedUserId('')
    setIsSelectedUserSheetOpen(false)
  }, [filteredUsers, selectedUserId])

  useEffect(() => {
    if (!selectedUser) {
      setEditForm(defaultEditForm)
      setEditError('')
      return
    }

    setEditForm(getSelectedUserDraft(selectedUser))
    setEditError('')
  }, [
    selectedUser?.canExportExcel,
    selectedUser?.canExportPdf,
    selectedUser?.id,
    selectedUser?.role,
    selectedUser?.team,
  ])

  const startCreate = () => {
    setCreateForm(defaultCreateForm)
    setCreateError('')
    setLoadError('')
    setActionMessage('')
    setIsCreatePasswordVisible(false)
    setIsCreateOpen(true)
  }

  const startReset = (user: ManagedUser) => {
    setResetForm({
      userId: user.id,
      newPassword: '',
    })
    setResetError('')
    setLoadError('')
    setFeedback('')
    setIsResetPasswordVisible(false)
    setIsSelectedUserSheetOpen(false)
    setIsResetOpen(true)
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateError('')
    const parsed = userCreateSchema.safeParse(createForm)
    if (!parsed.success) {
      setCreateError(
        parsed.error.issues[0]?.message ?? 'Please provide valid user details.',
      )
      return
    }

    setIsSubmitting(true)
    try {
      const payload = await callUsersApi<ManagedUser>('/api/users/create', {
        method: 'POST',
        body: parsed.data,
      })
      const successMessage =
        payload.warning ??
        (payload.verificationEmailSent
          ? 'User created and verification email sent'
          : 'User created')
      setActionMessage(successMessage)
      toast.success('User created', {
        description: payload.verificationEmailSent
          ? `Verification email sent to ${parsed.data.email}.`
          : undefined,
      })
      if (payload.warning) {
        toast.warning('Verification email was not sent', {
          description: payload.warning,
        })
      }
      setIsCreateOpen(false)
      setIsCreatePasswordVisible(false)
      setCreateForm(defaultCreateForm)
      await loadUsers()
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : 'Unable to create user.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setEditError('')
    const parsed = userUpdateSchema.safeParse(editForm)
    if (!parsed.success) {
      setEditError(
        parsed.error.issues[0]?.message ??
          'Please provide valid update values.',
      )
      return
    }
    const targetUser = users.find((user) => user.id === parsed.data.userId)
    const targetName = targetUser?.name || targetUser?.email || 'User'

    setIsSubmitting(true)
    try {
      await callUsersApi('/api/users/update', {
        method: 'POST',
        body: parsed.data,
      })
      setActionMessage('User updated')
      toast.success('User updated', {
        description: `${targetName}'s changes were saved.`,
      })
      await loadUsers()
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : 'Unable to update user.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setResetError('')
    const parsed = userResetPasswordSchema.safeParse(resetForm)
    if (!parsed.success) {
      setResetError(parsed.error.issues[0]?.message ?? passwordPolicy.message)
      return
    }
    const targetUser = users.find((user) => user.id === parsed.data.userId)
    const targetName = targetUser?.name || targetUser?.email || 'User'

    setIsSubmitting(true)
    try {
      await callUsersApi('/api/users/reset-password', {
        method: 'POST',
        body: parsed.data,
      })
      setActionMessage('Password reset')
      toast.success('Password reset', {
        description: `${targetName} must change password on next sign in.`,
      })
      setIsResetOpen(false)
      setIsResetPasswordVisible(false)
      setResetForm(defaultResetForm)
      await loadUsers()
    } catch (error) {
      setResetError(
        error instanceof Error
          ? error.message
          : 'Unable to reset password. Check password policy.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendVerification = async (user: ManagedUser) => {
    if (!canResendVerificationEmail(user)) {
      return
    }

    setEditError('')
    setLoadError('')
    setIsSubmitting(true)
    try {
      await callUsersApi('/api/users/resend-verification', {
        method: 'POST',
        body: { userId: user.id },
      })
      setActionMessage('Verification email sent')
      toast.success('Verification email sent', {
        description: `Sent to ${user.email}.`,
      })
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : 'Unable to resend verification email.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSetStatus = async (
    userId: string,
    action: 'activate' | 'deactivate',
  ) => {
    const targetUser = users.find((user) => user.id === userId)

    if (
      !canManageUserStatus ||
      isSuperAdmin(targetUser?.role ?? '') ||
      (action === 'deactivate' && userId === sessionUserId)
    ) {
      return
    }

    const endpoint =
      action === 'deactivate'
        ? '/api/users/deactivate'
        : '/api/users/reactivate'
    const label = action === 'deactivate' ? 'deactivate' : 'reactivate'
    const pastTense = action === 'deactivate' ? 'deactivated' : 'reactivated'
    const targetName = targetUser?.name || targetUser?.email || 'User'

    setIsSubmitting(true)
    try {
      const payload = await callUsersApi(endpoint, {
        method: 'POST',
        body: { userId },
      })
      setActionMessage(`User ${pastTense}`)
      toast.success(`User ${pastTense}`, {
        description:
          action === 'deactivate'
            ? `${targetName} can no longer sign in.`
            : `${targetName} can sign in again.`,
      })
      if (payload.warning) {
        toast.warning(
          'User status changed, but notification email could not be sent.',
          {
            description: payload.warning,
          },
        )
      }
      await loadUsers()
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : `Unable to ${label}.`,
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    const targetUser = users.find((user) => user.id === userId)

    if (userId === sessionUserId || isSuperAdmin(targetUser?.role ?? '')) {
      return
    }

    const targetName = targetUser?.name || targetUser?.email || 'User'

    setIsSubmitting(true)
    try {
      await callUsersApi('/api/users/delete', {
        method: 'POST',
        body: { userId },
      })
      setActionMessage('User deleted')
      setSelectedUserId('')
      setIsSelectedUserSheetOpen(false)
      toast.success('User deleted', {
        description: `${targetName} can no longer sign in.`,
      })
      await loadUsers()
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Unable to delete user.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDevDataReset = async () => {
    setIsDevResetting(true)
    setDevResetError('')

    try {
      const response = await fetch('/api/dev/data-reset', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          confirmation: devResetConfirmationText,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        deletedCounts?: Record<string, number>
      }

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to clear development data.')
      }

      setDevResetConfirmationText('')
      setIsDevResetDialogOpen(false)
      toast.success('Development data cleared', {
        description: 'Runtime intake and result tables were reset.',
      })
      await loadDevResetStatus()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to clear development data.'
      setDevResetError(message)
      toast.error('Development data was not cleared', {
        description: message,
      })
    } finally {
      setIsDevResetting(false)
    }
  }

  const handleExportCsv = () => {
    const csv = createUsersCsv(filteredUsers)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `settings-users-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  if (!canManageUsers) {
    return (
      <AppShell title="Settings" subtitle="Unauthorized">
        <div
          className={cn(
            'rounded-lg border bg-muted/20 p-4',
            PANEL_BORDER_CLASS,
          )}
        >
          <p className="text-xs text-muted-foreground">
            You do not have permission to manage users.
          </p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Settings"
      subtitle="Users and access control"
      pageHelp={{
        label: 'Guide me through this page',
        onStartTour: () => setTourStartSignal((current) => current + 1),
      }}
      tourTargets={{
        actions: SETTINGS_TOUR_TARGETS.createUserAction,
        title: SETTINGS_TOUR_TARGETS.title,
      }}
      actions={
        <Button size="sm" onClick={startCreate}>
          <IconFilePlus data-icon="inline-start" />
          Create user
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div {...getProductTourTargetProps(SETTINGS_TOUR_TARGETS.summary)}>
          <SettingsSummaryStats users={users} />
        </div>

        <section
          className={cn(
            'rounded-lg border bg-muted/20 p-3',
            PANEL_BORDER_CLASS,
          )}
          {...getProductTourTargetProps(SETTINGS_TOUR_TARGETS.filters)}
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <FieldGroup className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_10rem_11rem_10rem] xl:max-w-4xl">
              <Field className="gap-1">
                <FieldLabel htmlFor="settings-user-search" className="text-xs">
                  Search
                </FieldLabel>
                <InputGroup className="h-8 rounded-lg bg-background">
                  <InputGroupAddon>
                    <IconSearch />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="settings-user-search"
                    aria-label="Search users"
                    className="h-8 text-sm"
                    placeholder="Search users"
                    value={filters.search}
                    onChange={(event) =>
                      updateFilters({ search: event.target.value })
                    }
                  />
                </InputGroup>
              </Field>

              <Field className="gap-1">
                <FieldLabel htmlFor="role-filter" className="text-xs">
                  Role
                </FieldLabel>
                <Select
                  value={filters.role}
                  onValueChange={(value) =>
                    updateFilters({ role: value as RoleFilter })
                  }
                >
                  <SelectTrigger
                    id="role-filter"
                    size="sm"
                    className={cn(
                      SETTINGS_SELECT_TRIGGER_CLASS,
                      'w-full sm:w-40',
                    )}
                  >
                    <SelectValue>{getRoleFilterLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent {...SETTINGS_SELECT_CONTENT_PROPS}>
                    <SelectGroup>
                      <SelectLabel>Role filters</SelectLabel>
                      {roleFilterOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className={SETTINGS_SELECT_ITEM_CLASS}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field className="gap-1">
                <FieldLabel htmlFor="team-filter" className="text-xs">
                  Team
                </FieldLabel>
                <Select
                  value={filters.team}
                  onValueChange={(value) =>
                    updateFilters({ team: value as TeamFilter })
                  }
                >
                  <SelectTrigger
                    id="team-filter"
                    size="sm"
                    className={cn(
                      SETTINGS_SELECT_TRIGGER_CLASS,
                      'w-full sm:w-44',
                    )}
                  >
                    <SelectValue>{getTeamFilterLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent {...SETTINGS_SELECT_CONTENT_PROPS}>
                    <SelectGroup>
                      <SelectLabel>Team filters</SelectLabel>
                      {teamFilterOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className={SETTINGS_SELECT_ITEM_CLASS}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field className="gap-1">
                <FieldLabel htmlFor="status-filter" className="text-xs">
                  Status
                </FieldLabel>
                <Select
                  value={filters.status}
                  onValueChange={(value) =>
                    updateFilters({ status: value as StatusFilter })
                  }
                >
                  <SelectTrigger
                    id="status-filter"
                    size="sm"
                    className={cn(
                      SETTINGS_SELECT_TRIGGER_CLASS,
                      'w-full sm:w-40',
                    )}
                  >
                    <SelectValue>{getStatusFilterLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent {...SETTINGS_SELECT_CONTENT_PROPS}>
                    <SelectGroup>
                      <SelectLabel>Status filters</SelectLabel>
                      {statusFilterOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className={SETTINGS_SELECT_ITEM_CLASS}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={filteredUsers.length === 0}
            >
              <IconDownload data-icon="inline-start" />
              Export
            </Button>
          </div>
        </section>

        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : null}
        {feedback ? <p className="text-sm text-primary">{feedback}</p> : null}

        <div className="flex flex-col gap-4">
          <section
            className={cn(
              'min-w-0 overflow-hidden rounded-lg bg-card',
              PANEL_CARD_CLASS,
            )}
            {...getProductTourTargetProps(SETTINGS_TOUR_TARGETS.usersTable)}
          >
            <div
              className={cn(
                'flex items-center justify-between gap-3 border-b px-3 py-2',
                PANEL_BORDER_CLASS,
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Users</h2>
                <Badge variant="outline">
                  {filteredUsers.length.toLocaleString()} shown
                </Badge>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[940px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
                <TableHeader className="[&_tr]:border-border/60">
                  <TableRow className="bg-muted/35 hover:bg-muted/35">
                    <TableHead className="w-10 bg-muted/35" />
                    <TableHead className="min-w-64 bg-muted/35">User</TableHead>
                    <TableHead className="bg-muted/35">Role</TableHead>
                    <TableHead className="bg-muted/35">Team</TableHead>
                    <TableHead className="bg-muted/35">Status</TableHead>
                    <TableHead className="bg-muted/35">Verification</TableHead>
                    <TableHead className="bg-muted/35">Exports</TableHead>
                    <TableHead className="min-w-40 bg-muted/35">
                      Updated
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr:last-child]:border-b-0">
                  {isLoading ? (
                    Array.from({ length: 10 }, (_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={8}>
                          <Skeleton className="h-8 w-full rounded-md" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : paginatedUsers.users.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-32 text-center text-xs text-muted-foreground"
                      >
                        No users found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedUsers.users.map((user) => {
                      const isSelected = user.id === selectedUserId

                      return (
                        <TableRow
                          key={user.id}
                          aria-selected={isSelected}
                          tabIndex={0}
                          className={cn(
                            'cursor-pointer hover:bg-muted/35',
                            isSelected && 'bg-muted/60 hover:bg-muted/60',
                          )}
                          onClick={() => openSelectedUserSheet(user.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openSelectedUserSheet(user.id)
                            }
                          }}
                        >
                          <TableCell>
                            <Checkbox
                              aria-label={`Select ${user.name}`}
                              checked={isSelected}
                              onCheckedChange={(value) => {
                                if (value === true) {
                                  openSelectedUserSheet(user.id)
                                }
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <UserIdentity user={user} />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {formatRole(user.role)}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatTeam(user.team)}</TableCell>
                          <TableCell>
                            <UserStatusBadge isBanned={user.isBanned} />
                          </TableCell>
                          <TableCell>
                            <UserVerificationBadge
                              emailVerified={user.emailVerified}
                            />
                          </TableCell>
                          <TableCell>
                            <ExportPermissionIcons user={user} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {getUserUpdatedLabel(user)}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div
              className={cn(
                'flex flex-col gap-3 border-t px-3 py-3 sm:flex-row sm:items-center sm:justify-between',
                PANEL_BORDER_CLASS,
              )}
              {...getProductTourTargetProps(
                SETTINGS_TOUR_TARGETS.usersPagination,
              )}
            >
              <p className="text-xs text-muted-foreground">
                Showing {paginatedUsers.start.toLocaleString()} to{' '}
                {paginatedUsers.end.toLocaleString()} of{' '}
                {filteredUsers.length.toLocaleString()} users
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Previous page"
                  onClick={() =>
                    setCurrentPage((page) => Math.max(1, page - 1))
                  }
                  disabled={paginatedUsers.currentPage === 1}
                >
                  <IconChevronLeft />
                </Button>
                {paginationPages.map((page) => (
                  <Button
                    key={page}
                    type="button"
                    variant={
                      page === paginatedUsers.currentPage
                        ? 'default'
                        : 'outline'
                    }
                    size="xs"
                    aria-current={
                      page === paginatedUsers.currentPage ? 'page' : undefined
                    }
                    onClick={() => setCurrentPage(page)}
                  >
                    {page}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Next page"
                  onClick={() =>
                    setCurrentPage((page) =>
                      Math.min(paginatedUsers.totalPages, page + 1),
                    )
                  }
                  disabled={
                    paginatedUsers.currentPage === paginatedUsers.totalPages
                  }
                >
                  <IconChevronRight />
                </Button>
              </div>
            </div>
          </section>
        </div>

        <SelectedUserSheet
          open={isSelectedUserSheetOpen}
          onOpenChange={setIsSelectedUserSheetOpen}
          user={selectedUser}
          draft={editForm}
          error={editError}
          isSubmitting={isSubmitting}
          currentUserId={sessionUserId}
          canManageUserStatus={canManageUserStatus}
          roles={assignableRoles}
          teams={teams}
          onDraftChange={setEditForm}
          onSave={handleUpdate}
          onResetPassword={startReset}
          onResendVerification={handleResendVerification}
          onStatusChange={(userId, action) =>
            void handleSetStatus(userId, action)
          }
          onDeleteUser={(userId) => void handleDeleteUser(userId)}
        />

        <section
          className={cn('overflow-hidden rounded-lg bg-card', PANEL_CARD_CLASS)}
          {...getProductTourTargetProps(SETTINGS_TOUR_TARGETS.roleMatrix)}
        >
          <div className={cn('border-b px-3 py-2', PANEL_BORDER_CLASS)}>
            <h2 className="text-sm font-semibold">Role access matrix</h2>
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-[560px] text-xs [&_td]:px-3 [&_td]:py-2 [&_th]:h-8 [&_th]:px-3">
              <TableHeader className="[&_tr]:border-border/60">
                <TableRow className="bg-muted/35 hover:bg-muted/35">
                  <TableHead className="bg-muted/35">Permission</TableHead>
                  {roles.map((role) => (
                    <TableHead key={role} className="bg-muted/35">
                      {formatRole(role)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b-0">
                {roleAccessAreas.map((area) => (
                  <TableRow key={area.key} className="hover:bg-muted/35">
                    <TableCell className="font-medium">{area.label}</TableCell>
                    {roles.map((role) => (
                      <TableCell key={role} className="text-xs">
                        {roleAccessMatrix[role][area.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {devResetStatus ? (
          <DevDataResetPanel
            status={devResetStatus}
            error={devResetError}
            isLoading={isDevResetLoading}
            isDialogOpen={isDevResetDialogOpen}
            confirmationText={devResetConfirmationText}
            isResetting={isDevResetting}
            onDialogOpenChange={setIsDevResetDialogOpen}
            onConfirmationTextChange={setDevResetConfirmationText}
            onReset={() => void handleDevDataReset()}
          />
        ) : null}
      </div>

      <Sheet
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open)
          if (!open) {
            setCreateError('')
            setIsCreatePasswordVisible(false)
          }
        }}
      >
        <SheetContent side="right" className={PANEL_BORDER_CLASS}>
          <SheetHeader className={cn('border-b p-4', PANEL_BORDER_CLASS)}>
            <SheetTitle className="text-sm">Create user</SheetTitle>
          </SheetHeader>
          <form
            data-testid="create-user-sheet-form"
            onSubmit={handleCreate}
            className={createUserSheetLayoutClasses.form}
          >
            <div
              data-testid="create-user-sheet-body"
              className={createUserSheetLayoutClasses.body}
            >
              <FieldGroup className="gap-3">
                {createError ? (
                  <FieldDescription className="text-destructive">
                    {createError}
                  </FieldDescription>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="create-email" className="text-xs">
                    Email
                  </FieldLabel>
                  <Input
                    id="create-email"
                    type="email"
                    value={createForm.email}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }))
                    }
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="create-name" className="text-xs">
                    Name
                  </FieldLabel>
                  <Input
                    id="create-name"
                    value={createForm.name}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="create-password" className="text-xs">
                    Temporary password
                  </FieldLabel>
                  <PasswordInput
                    id="create-password"
                    isVisible={isCreatePasswordVisible}
                    onVisibilityChange={setIsCreatePasswordVisible}
                    visibilityLabel="temporary password"
                    value={createForm.password}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        password: event.target.value,
                      }))
                    }
                    required
                  />
                  <FieldDescription className="text-xs">
                    User must change this password after first sign in.
                  </FieldDescription>
                  <FieldDescription className="text-xs">
                    A verification email will be sent after creation.
                  </FieldDescription>
                  <FieldDescription className="text-xs">
                    {passwordPolicy.message}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="create-role" className="text-xs">
                    Role
                  </FieldLabel>
                  <Select
                    value={createForm.role}
                    onValueChange={(value) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        role: value as UserCreateInput['role'],
                      }))
                    }
                  >
                    <SelectTrigger
                      id="create-role"
                      size="sm"
                      className={cn(SETTINGS_SELECT_TRIGGER_CLASS, 'w-full')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent {...SETTINGS_SELECT_CONTENT_PROPS}>
                      <SelectGroup>
                        <SelectLabel>Roles</SelectLabel>
                        {assignableRoleSelectOptions.map((role) => (
                          <SelectItem
                            key={role.value}
                            value={role.value}
                            className={SETTINGS_SELECT_ITEM_CLASS}
                          >
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="create-team" className="text-xs">
                    Team
                  </FieldLabel>
                  <Select
                    value={createForm.team}
                    onValueChange={(value) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        team: value as UserCreateInput['team'],
                      }))
                    }
                  >
                    <SelectTrigger
                      id="create-team"
                      size="sm"
                      className={cn(SETTINGS_SELECT_TRIGGER_CLASS, 'w-full')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent {...SETTINGS_SELECT_CONTENT_PROPS}>
                      <SelectGroup>
                        <SelectLabel>Teams</SelectLabel>
                        {teams.map((team) => (
                          <SelectItem
                            key={team}
                            value={team}
                            className={SETTINGS_SELECT_ITEM_CLASS}
                          >
                            {formatTeam(team)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <Label className="text-xs" htmlFor="create-can-export-pdf">
                    <span className="flex items-center gap-2">
                      <Checkbox
                        id="create-can-export-pdf"
                        checked={createForm.canExportPdf}
                        onCheckedChange={(value) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            canExportPdf: value === true,
                          }))
                        }
                      />
                      Allow PDF export
                    </span>
                  </Label>
                </Field>
                <Field>
                  <Label className="text-xs" htmlFor="create-can-export-excel">
                    <span className="flex items-center gap-2">
                      <Checkbox
                        id="create-can-export-excel"
                        checked={createForm.canExportExcel}
                        onCheckedChange={(value) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            canExportExcel: value === true,
                          }))
                        }
                      />
                      Allow Excel export
                    </span>
                  </Label>
                </Field>
              </FieldGroup>
            </div>
            <SheetFooter
              data-testid="create-user-sheet-footer"
              className={cn(
                createUserSheetLayoutClasses.footer,
                PANEL_BORDER_CLASS,
              )}
            >
              <Button
                variant="outline"
                type="button"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create user'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={isResetOpen}
        onOpenChange={(open) => {
          setIsResetOpen(open)
          if (!open) {
            setResetError('')
            setIsResetPasswordVisible(false)
          }
        }}
      >
        <SheetContent side="right" className={PANEL_BORDER_CLASS}>
          <SheetHeader className={cn('border-b p-4', PANEL_BORDER_CLASS)}>
            <SheetTitle className="text-sm">Reset user password</SheetTitle>
          </SheetHeader>
          <form
            onSubmit={handleResetPassword}
            className="flex flex-col gap-4 px-4 py-4"
          >
            <FieldGroup className="gap-3">
              {resetError ? (
                <FieldDescription className="text-destructive">
                  {resetError}
                </FieldDescription>
              ) : null}
              <Field>
                <FieldLabel htmlFor="reset-password" className="text-xs">
                  New temporary password
                </FieldLabel>
                <PasswordInput
                  id="reset-password"
                  isVisible={isResetPasswordVisible}
                  onVisibilityChange={setIsResetPasswordVisible}
                  visibilityLabel="new temporary password"
                  value={resetForm.newPassword}
                  onChange={(event) =>
                    setResetForm((prev) => ({
                      ...prev,
                      newPassword: event.target.value,
                    }))
                  }
                  required
                />
                <FieldDescription className="text-xs">
                  {passwordPolicy.message}
                </FieldDescription>
              </Field>
            </FieldGroup>
            <SheetFooter
              className={cn('mt-auto border-t p-4', PANEL_BORDER_CLASS)}
            >
              <Button
                variant="outline"
                type="button"
                size="sm"
                onClick={() => setIsResetOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Set password'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      <SettingsTour startSignal={tourStartSignal} />
    </AppShell>
  )
}
