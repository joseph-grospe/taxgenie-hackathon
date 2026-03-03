import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'

import { authClient } from '@/lib/auth-client'
import {
  parseSessionContext,
  roleAccessMatrix
} from '@/lib/access-control'
import {
  teamLabels,
  teamOptions,
  userRoles,
} from '@/lib/user-roles'
import {
  type ManagedUser,
  passwordPolicy,
  type UserCreateInput,
  userCreateSchema,
  type UserUpdateInput,
  type UserResetPasswordInput,
  userResetPasswordSchema,
  userUpdateSchema,
} from '@/lib/users-module'
import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { IconFilePlus, IconLock, IconPencil, IconUsers } from '@tabler/icons-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const defaultCreateForm: UserCreateInput = {
  email: '',
  name: '',
  password: '',
  role: userRoles[2],
  team: 'other',
  canExportPdf: false,
  canExportExcel: false,
}

const defaultEditForm: UserUpdateInput = {
  userId: '',
  role: userRoles[2],
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
  users?: Array<T>
}

const parseApiPayload = async <T,>(response: Response): Promise<ApiPayload<T>> => {
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

const formatTeam = (team: (typeof teamOptions)[number]) =>
  teamLabels[team] ?? team

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
})

function RouteComponent() {
  const { data: session, isPending } = authClient.useSession()
  const [users, setUsers] = useState<Array<ManagedUser>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isResetOpen, setIsResetOpen] = useState(false)
  const [createForm, setCreateForm] = useState<UserCreateInput>(defaultCreateForm)
  const [editForm, setEditForm] = useState<UserUpdateInput>(defaultEditForm)
  const [resetForm, setResetForm] = useState<UserResetPasswordInput>(defaultResetForm)
  const [createError, setCreateError] = useState('')
  const [editError, setEditError] = useState('')
  const [resetError, setResetError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current)
      }
    }
  }, [])

  const context = session?.user ? parseSessionContext(session.user) : null

  const canManageUsers = context?.role === 'admin'
  const roles = useMemo(() => userRoles, [])
  const teams = useMemo(() => teamOptions, [])

  const setActionMessage = (message: string) => {
    setFeedback(message)
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current)
    }

    feedbackTimerRef.current = setTimeout(() => setFeedback(''), 2500)
  }

  const loadUsers = async () => {
    const payload = await callUsersApi<ManagedUser>('/api/users/list')
    setUsers(payload.users ?? [])
  }

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
          error instanceof Error ? error.message : 'Unable to load managed users.',
        )
      } finally {
        setIsLoading(false)
      }
    }

    void load()
  }, [isPending, session?.user?.id])

  const startCreate = () => {
    setCreateForm(defaultCreateForm)
    setCreateError('')
    setLoadError('')
    setActionMessage('')
    setIsCreateOpen(true)
  }

  const startEdit = (user: ManagedUser) => {
    setEditForm({
      userId: user.id,
      role: user.role,
      team: user.team,
      canExportPdf: user.canExportPdf,
      canExportExcel: user.canExportExcel,
    })
    setEditError('')
    setLoadError('')
    setFeedback('')
    setIsEditOpen(true)
  }

  const startReset = (user: ManagedUser) => {
    setResetForm({
      userId: user.id,
      newPassword: '',
    })
    setResetError('')
    setLoadError('')
    setFeedback('')
    setIsResetOpen(true)
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateError('')
    const parsed = userCreateSchema.safeParse(createForm)
    if (!parsed.success) {
      setCreateError(parsed.error.issues[0]?.message ?? 'Please provide valid user details.')
      return
    }

    setIsSubmitting(true)
    try {
      await callUsersApi('/api/users/create', {
        method: 'POST',
        body: parsed.data,
      })
      setActionMessage('User created')
      setIsCreateOpen(false)
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
      setEditError(parsed.error.issues[0]?.message ?? 'Please provide valid update values.')
      return
    }

    setIsSubmitting(true)
    try {
      await callUsersApi('/api/users/update', {
        method: 'POST',
        body: parsed.data,
      })
      setActionMessage('User updated')
      setIsEditOpen(false)
      await loadUsers()
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to update user.')
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

    setIsSubmitting(true)
    try {
      await callUsersApi('/api/users/reset-password', {
        method: 'POST',
        body: parsed.data,
      })
      setActionMessage('Password reset')
      setIsResetOpen(false)
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

  const handleSetStatus = async (
    userId: string,
    action: 'activate' | 'deactivate',
  ) => {
    const endpoint =
      action === 'deactivate' ? '/api/users/deactivate' : '/api/users/reactivate'
    const label = action === 'deactivate' ? 'deactivate' : 'reactivate'

    if (action === 'deactivate' && !window.confirm('Deactivate this user?')) {
      return
    }

    setIsSubmitting(true)
    try {
      await callUsersApi(endpoint, {
        method: 'POST',
        body: { userId },
      })
      setActionMessage(`User ${label}d`)
      await loadUsers()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : `Unable to ${label}.`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const roleAccessRows = (['admin', 'editor', 'viewer'] as const).map((role) => (
    <div
      key={role}
      className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
    >
      <p className="text-sm font-medium capitalize">{role}</p>
      <p className="text-xs text-muted-foreground">
        Settings: {roleAccessMatrix[role].settings}
      </p>
      <p className="text-xs text-muted-foreground">
        Upload: {roleAccessMatrix[role].upload}
      </p>
      <p className="text-xs text-muted-foreground">
        Reports: {roleAccessMatrix[role].reports}
      </p>
      <p className="text-xs text-muted-foreground">
        Audit: {roleAccessMatrix[role].audit}
      </p>
    </div>
  ))

  if (!canManageUsers) {
    return (
      <AppShell title="Settings" subtitle="Unauthorized">
        <div className="rounded border border-border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
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
      actions={
        <Button size="sm" onClick={startCreate}>
          <IconFilePlus className="size-4" />
          Create user
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Users</h2>
          {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
          {feedback ? <p className="text-sm text-primary">{feedback}</p> : null}

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Export (PDF)</TableHead>
                  <TableHead>Export (Excel)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? null : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{user.role}</Badge>
                      </TableCell>
                      <TableCell>{formatTeam(user.team)}</TableCell>
                      <TableCell>
                        <Badge variant={user.isBanned ? 'destructive' : 'secondary'}>
                          {user.isBanned ? 'Deactivated' : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell>{user.canExportPdf ? 'Allowed' : 'Blocked'}</TableCell>
                      <TableCell>{user.canExportExcel ? 'Allowed' : 'Blocked'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEdit(user)}
                          >
                            <IconPencil className="size-4" />
                            <span className="sr-only">Edit user</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startReset(user)}
                          >
                            <IconLock className="size-4" />
                            <span className="sr-only">Reset password</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void handleSetStatus(
                                user.id,
                                user.isBanned ? 'activate' : 'deactivate',
                              )
                            }
                          >
                            {user.isBanned ? 'Activate' : 'Deactivate'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {isLoading ? <p>Loading users...</p> : null}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <IconUsers className="size-4" />
              Role access matrix
            </div>
            <div className="space-y-2">{roleAccessRows}</div>
          </div>

          <div className="rounded-xl border border-dashed p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <IconFilePlus className="size-4" />
              User administration
            </div>
            <p className="text-sm text-muted-foreground">
              Admin can create users, set teams/roles, set export overrides, and
              force password resets.
            </p>
          </div>
        </div>
      </div>

      <Sheet
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open)
          if (!open) {
            setCreateError('')
          }
        }}
      >
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Create user</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleCreate} className="px-6 py-4">
            <FieldGroup>
              {createError ? (
                <FieldDescription className="text-destructive">
                  {createError}
                </FieldDescription>
              ) : null}
              <Field>
                <FieldLabel htmlFor="create-email">Email</FieldLabel>
                <Input
                  id="create-email"
                  type="email"
                  value={createForm.email}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, email: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="create-name">Name</FieldLabel>
                <Input
                  id="create-name"
                  value={createForm.name}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="create-password">Temporary password</FieldLabel>
                <Input
                  id="create-password"
                  type="password"
                  value={createForm.password}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      password: event.target.value,
                    }))
                  }
                  required
                />
                <FieldDescription>
                  User must change this password after first sign in.
                </FieldDescription>
                <FieldDescription>
                  {passwordPolicy.message}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="create-role">Role</FieldLabel>
                <Select
                  value={createForm.role}
                  onValueChange={(value) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      role: value as UserCreateInput['role'],
                    }))
                  }
                >
                  <SelectTrigger id="create-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="create-team">Team</FieldLabel>
                <Select
                  value={createForm.team}
                  onValueChange={(value) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      team: value as UserCreateInput['team'],
                    }))
                  }
                >
                  <SelectTrigger id="create-team">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team} value={team}>
                        {formatTeam(team)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <Label className="text-sm" htmlFor="create-can-export-pdf">
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
                <Label className="text-sm" htmlFor="create-can-export-excel">
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
            <SheetFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create user'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={isEditOpen}
        onOpenChange={(open) => {
          setIsEditOpen(open)
          if (!open) {
            setEditError('')
          }
        }}
      >
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Edit user</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleUpdate} className="px-6 py-4">
            <FieldGroup>
              {editError ? (
                <FieldDescription className="text-destructive">
                  {editError}
                </FieldDescription>
              ) : null}
              <Field>
                <FieldLabel htmlFor="edit-role">Role</FieldLabel>
                <Select
                  value={editForm.role}
                  onValueChange={(value) =>
                    setEditForm((prev) => ({
                      ...prev,
                      role: value as UserUpdateInput['role'],
                    }))
                  }
                >
                  <SelectTrigger id="edit-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="edit-team">Team</FieldLabel>
                <Select
                  value={editForm.team}
                  onValueChange={(value) =>
                    setEditForm((prev) => ({
                      ...prev,
                      team: value as UserUpdateInput['team'],
                    }))
                  }
                >
                  <SelectTrigger id="edit-team">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team} value={team}>
                        {formatTeam(team)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <Label className="text-sm" htmlFor="edit-can-export-pdf">
                  <span className="flex items-center gap-2">
                    <Checkbox
                      id="edit-can-export-pdf"
                      checked={editForm.canExportPdf}
                      onCheckedChange={(value) =>
                        setEditForm((prev) => ({
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
                <Label className="text-sm" htmlFor="edit-can-export-excel">
                  <span className="flex items-center gap-2">
                    <Checkbox
                      id="edit-can-export-excel"
                      checked={editForm.canExportExcel}
                      onCheckedChange={(value) =>
                        setEditForm((prev) => ({
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
            <SheetFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setIsEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save changes'}
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
          }
        }}
      >
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Reset user password</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleResetPassword} className="px-6 py-4">
            <FieldGroup>
              {resetError ? (
                <FieldDescription className="text-destructive">
                  {resetError}
                </FieldDescription>
              ) : null}
              <Field>
                <FieldLabel htmlFor="reset-password">New temporary password</FieldLabel>
                <Input
                  id="reset-password"
                  type="password"
                  value={resetForm.newPassword}
                  onChange={(event) =>
                    setResetForm((prev) => ({
                      ...prev,
                      newPassword: event.target.value,
                    }))
                  }
                  required
                />
                <FieldDescription>{passwordPolicy.message}</FieldDescription>
              </Field>
            </FieldGroup>
            <SheetFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setIsResetOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Set password'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </AppShell>
  )
}
