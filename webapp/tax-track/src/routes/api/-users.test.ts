import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adminUpdateUser: vi.fn(),
  banUser: vi.fn(),
  createUser: vi.fn(),
  getUser: vi.fn(),
  listUsers: vi.fn(),
  logAuditEvent: vi.fn(),
  requireAdminContext: vi.fn(),
  requireSuperAdminContext: vi.fn(),
  sendUserStatusNotificationEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
  setRole: vi.fn(),
  setUserPassword: vi.fn(),
  unbanUser: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/auth-server', () => ({
  auth: {
    api: {
      adminUpdateUser: mocks.adminUpdateUser,
      banUser: mocks.banUser,
      createUser: mocks.createUser,
      getUser: mocks.getUser,
      listUsers: mocks.listUsers,
      sendVerificationEmail: mocks.sendVerificationEmail,
      setRole: mocks.setRole,
      setUserPassword: mocks.setUserPassword,
      unbanUser: mocks.unbanUser,
    },
  },
}))

vi.mock('@/lib/user-admin-server', () => ({
  badRequestResponse: (message: string) =>
    new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  jsonResponse: (payload: unknown, init: { status?: number } = {}) =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  notAuthenticatedResponse: (message = 'Authentication is required.') =>
    new Response(JSON.stringify({ error: message }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  parseJsonBody: async (
    request: Request,
    schema: {
      safeParse: (
        body: unknown,
      ) =>
        | { success: true; data: unknown }
        | { success: false; error: { issues: Array<{ message?: string }> } }
    },
  ) => {
    const body = await request.json().catch(() => null)
    const parsed = schema.safeParse(body)

    return parsed.success ? parsed.data : null
  },
  parseJsonBodyWithDetails: async (
    request: Request,
    schema: {
      safeParse: (
        body: unknown,
      ) =>
        | { success: true; data: unknown }
        | { success: false; error: { issues: Array<{ message?: string }> } }
    },
  ) => {
    const body = await request.json().catch(() => null)
    const parsed = schema.safeParse(body)

    return parsed.success
      ? { ok: true as const, data: parsed.data }
      : {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? 'Invalid request payload.',
        }
  },
  requireAdminContext: mocks.requireAdminContext,
  requireSuperAdminContext: mocks.requireSuperAdminContext,
}))

vi.mock('@/lib/user-status-email-server', () => ({
  sendUserStatusNotificationEmail: mocks.sendUserStatusNotificationEmail,
}))

const { createUserHandler } = await import('@/routes/api/users/create')
const { deactivateUserHandler } = await import('@/routes/api/users/deactivate')
const { deleteUserHandler } = await import('@/routes/api/users/delete')
const { listUsersHandler } = await import('@/routes/api/users/list')
const { reactivateUserHandler } = await import('@/routes/api/users/reactivate')
const { resendVerificationHandler } =
  await import('@/routes/api/users/resend-verification')
const { resetUserPasswordHandler } =
  await import('@/routes/api/users/reset-password')
const { updateUserHandler } = await import('@/routes/api/users/update')

const validCreateBody = {
  email: 'new.user@example.com',
  name: 'New User',
  password: 'TempPassword1!',
  role: 'editor',
  team: 'tax_team',
  canExportPdf: true,
  canExportExcel: false,
}

const createdUser = {
  id: 'user-1',
  email: 'new.user@example.com',
  name: 'New User',
  role: 'editor',
  team: 'tax_team',
  canExportPdf: true,
  canExportExcel: false,
  emailVerified: false,
  mustChangePassword: true,
  banned: false,
}

const deletedUser = {
  ...createdUser,
  banned: true,
  banReason: 'Deleted by admin',
  deletedAt: '2026-05-18T08:00:00.000Z',
  deletedByUserId: 'admin-1',
  deletedReason: 'Deleted by admin',
}

const superAdminUser = {
  ...createdUser,
  id: 'super-admin-1',
  email: 'seed.admin@example.com',
  name: 'Seed Admin',
  role: 'super_admin',
  canExportPdf: true,
  canExportExcel: true,
}

const buildJsonRequest = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'better-auth.session=admin-session',
    },
    body: JSON.stringify(body),
  })

const buildGetRequest = (path: string) =>
  new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: {
      cookie: 'better-auth.session=admin-session',
    },
  })

const readJson = async (response: Response) => response.json()

describe('/api/users/create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.createUser.mockResolvedValue({ user: createdUser })
    mocks.sendVerificationEmail.mockResolvedValue({ status: true })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('creates an unverified user and sends verification without admin headers', async () => {
    const request = buildJsonRequest('/api/users/create', validCreateBody)

    const response = await createUserHandler({ request })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      user: {
        id: 'user-1',
        email: 'new.user@example.com',
        emailVerified: false,
        mustChangePassword: true,
      },
      verificationEmailSent: true,
    })
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: request.headers,
        body: expect.objectContaining({
          data: expect.objectContaining({
            emailVerified: false,
            mustChangePassword: true,
          }),
        }),
      }),
    )
    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      body: {
        email: 'new.user@example.com',
        callbackURL: '/login',
      },
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'user_created',
        actorUserId: 'admin-1',
        targetId: 'user-1',
        metadata: expect.objectContaining({
          verificationEmailSent: true,
        }),
      }),
    )
  })

  it('keeps the created user when verification email sending fails', async () => {
    mocks.sendVerificationEmail.mockRejectedValue(new Error('SES unavailable'))
    const request = buildJsonRequest('/api/users/create', validCreateBody)

    const response = await createUserHandler({ request })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      user: {
        id: 'user-1',
      },
      verificationEmailSent: false,
      warning:
        'User was created, but the verification email could not be sent.',
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        metadata: expect.objectContaining({
          verificationEmailSent: false,
        }),
      }),
    )
  })

  it('maps duplicate email failures to a safe message', async () => {
    mocks.createUser.mockRejectedValue(new Error('User already exists'))

    const response = await createUserHandler({
      request: buildJsonRequest('/api/users/create', validCreateBody),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'A user with this email already exists.',
    })
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('rejects attempts to create a super admin through the API', async () => {
    const response = await createUserHandler({
      request: buildJsonRequest('/api/users/create', {
        ...validCreateBody,
        role: 'super_admin',
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.createUser).not.toHaveBeenCalled()
  })
})

describe('/api/users/list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.listUsers.mockResolvedValue({
      users: [createdUser, deletedUser],
    })
  })

  it('hides soft deleted users from the managed list', async () => {
    const request = buildGetRequest('/api/users/list')

    const response = await listUsersHandler({ request })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({
      users: [
        {
          id: 'user-1',
          isDeleted: false,
        },
      ],
      total: 1,
    })
  })
})

describe('/api/users/update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.getUser.mockResolvedValue(createdUser)
    mocks.setRole.mockResolvedValue({ ok: true })
    mocks.adminUpdateUser.mockResolvedValue({ ok: true })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('rejects attempts to promote a user to super admin through the API', async () => {
    const response = await updateUserHandler({
      request: buildJsonRequest('/api/users/update', {
        userId: 'user-1',
        role: 'super_admin',
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.setRole).not.toHaveBeenCalled()
  })

  it('rejects attempts to demote the super admin through the API', async () => {
    mocks.getUser.mockResolvedValue(superAdminUser)

    const response = await updateUserHandler({
      request: buildJsonRequest('/api/users/update', {
        userId: 'super-admin-1',
        role: 'admin',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'The super admin role cannot be changed.',
    })
    expect(mocks.setRole).not.toHaveBeenCalled()
    expect(mocks.adminUpdateUser).not.toHaveBeenCalled()
  })
})

describe('/api/users/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.getUser.mockResolvedValue(createdUser)
    mocks.banUser.mockResolvedValue({ user: { ...createdUser, banned: true } })
    mocks.adminUpdateUser.mockResolvedValue({ ok: true })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires an admin session', async () => {
    mocks.requireAdminContext.mockResolvedValue(null)

    const response = await deleteUserHandler({
      request: buildJsonRequest('/api/users/delete', {
        userId: 'user-1',
      }),
    })

    expect(response.status).toBe(401)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.banUser).not.toHaveBeenCalled()
  })

  it('rejects self deletion', async () => {
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'user-1',
      role: 'admin',
    })

    const response = await deleteUserHandler({
      request: buildJsonRequest('/api/users/delete', {
        userId: 'user-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You cannot delete your own account.',
    })
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it('soft deletes the target user and logs the action', async () => {
    const request = buildJsonRequest('/api/users/delete', {
      userId: 'user-1',
    })

    const response = await deleteUserHandler({ request })

    expect(response.status).toBe(200)
    expect(mocks.getUser).toHaveBeenCalledWith({
      headers: request.headers,
      query: {
        id: 'user-1',
      },
    })
    expect(mocks.banUser).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'user-1',
        banReason: 'Deleted by admin',
      },
    })
    expect(mocks.adminUpdateUser).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'user-1',
        data: {
          deletedAt: expect.any(Date),
          deletedByUserId: 'admin-1',
          deletedReason: 'Deleted by admin',
        },
      },
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'user_deleted',
        actorUserId: 'admin-1',
        targetId: 'user-1',
        targetType: 'user',
      }),
    )
  })

  it('rejects deleting the super admin account', async () => {
    mocks.getUser.mockResolvedValue(superAdminUser)

    const response = await deleteUserHandler({
      request: buildJsonRequest('/api/users/delete', {
        userId: 'super-admin-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'The super admin account cannot be deleted.',
    })
    expect(mocks.banUser).not.toHaveBeenCalled()
    expect(mocks.adminUpdateUser).not.toHaveBeenCalled()
  })

  it('rejects already deleted users', async () => {
    mocks.getUser.mockResolvedValue(deletedUser)

    const response = await deleteUserHandler({
      request: buildJsonRequest('/api/users/delete', {
        userId: 'user-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'This user has been deleted.',
    })
    expect(mocks.banUser).not.toHaveBeenCalled()
    expect(mocks.adminUpdateUser).not.toHaveBeenCalled()
  })
})

describe('/api/users/deactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireSuperAdminContext.mockResolvedValue({
      userId: 'super-admin-1',
      role: 'super_admin',
    })
    mocks.getUser.mockResolvedValue(createdUser)
    mocks.banUser.mockResolvedValue({ user: { ...createdUser, banned: true } })
    mocks.sendUserStatusNotificationEmail.mockResolvedValue(undefined)
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires a super admin session', async () => {
    mocks.requireSuperAdminContext.mockResolvedValue(null)

    const response = await deactivateUserHandler({
      request: buildJsonRequest('/api/users/deactivate', {
        userId: 'user-1',
      }),
    })

    expect(response.status).toBe(401)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.banUser).not.toHaveBeenCalled()
    expect(mocks.sendUserStatusNotificationEmail).not.toHaveBeenCalled()
  })

  it('rejects invalid deactivate payloads without sending notification', async () => {
    const response = await deactivateUserHandler({
      request: buildJsonRequest('/api/users/deactivate', {
        userId: '',
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.banUser).not.toHaveBeenCalled()
    expect(mocks.sendUserStatusNotificationEmail).not.toHaveBeenCalled()
  })

  it('deactivates the target user, notifies them, and logs the super admin actor', async () => {
    const request = buildJsonRequest('/api/users/deactivate', {
      userId: 'user-1',
    })

    const response = await deactivateUserHandler({ request })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      notificationEmailSent: true,
    })
    expect(mocks.banUser).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'user-1',
        banReason: 'Deactivated by admin',
      },
    })
    expect(mocks.sendUserStatusNotificationEmail).toHaveBeenCalledWith({
      status: 'deactivated',
      user: {
        email: 'new.user@example.com',
        name: 'New User',
      },
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'user_deactivated',
        actorUserId: 'super-admin-1',
        targetId: 'user-1',
      }),
    )
  })

  it('keeps deactivation successful when notification sending fails', async () => {
    mocks.sendUserStatusNotificationEmail.mockRejectedValue(
      new Error('SES unavailable'),
    )
    const request = buildJsonRequest('/api/users/deactivate', {
      userId: 'user-1',
    })

    const response = await deactivateUserHandler({ request })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      notificationEmailSent: false,
      warning: 'User status changed, but notification email could not be sent.',
    })
    expect(mocks.banUser).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'user-1',
        banReason: 'Deactivated by admin',
      },
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'user_deactivated',
        actorUserId: 'super-admin-1',
        targetId: 'user-1',
      }),
    )
  })

  it('rejects deactivating the super admin account', async () => {
    mocks.getUser.mockResolvedValue(superAdminUser)

    const response = await deactivateUserHandler({
      request: buildJsonRequest('/api/users/deactivate', {
        userId: 'other-super-admin',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'The super admin account cannot be deactivated.',
    })
    expect(mocks.banUser).not.toHaveBeenCalled()
    expect(mocks.sendUserStatusNotificationEmail).not.toHaveBeenCalled()
  })
})

describe('/api/users/reactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireSuperAdminContext.mockResolvedValue({
      userId: 'super-admin-1',
      role: 'super_admin',
    })
    mocks.getUser.mockResolvedValue({
      ...createdUser,
      banned: true,
    })
    mocks.unbanUser.mockResolvedValue({
      user: { ...createdUser, banned: false },
    })
    mocks.sendUserStatusNotificationEmail.mockResolvedValue(undefined)
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires a super admin session', async () => {
    mocks.requireSuperAdminContext.mockResolvedValue(null)

    const response = await reactivateUserHandler({
      request: buildJsonRequest('/api/users/reactivate', {
        userId: 'user-1',
      }),
    })

    expect(response.status).toBe(401)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.unbanUser).not.toHaveBeenCalled()
    expect(mocks.sendUserStatusNotificationEmail).not.toHaveBeenCalled()
  })

  it('rejects invalid reactivate payloads without sending notification', async () => {
    const response = await reactivateUserHandler({
      request: buildJsonRequest('/api/users/reactivate', {
        userId: '',
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.unbanUser).not.toHaveBeenCalled()
    expect(mocks.sendUserStatusNotificationEmail).not.toHaveBeenCalled()
  })

  it('reactivates the target user, notifies them, and logs the super admin actor', async () => {
    const request = buildJsonRequest('/api/users/reactivate', {
      userId: 'user-1',
    })

    const response = await reactivateUserHandler({ request })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      notificationEmailSent: true,
    })
    expect(mocks.unbanUser).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'user-1',
      },
    })
    expect(mocks.sendUserStatusNotificationEmail).toHaveBeenCalledWith({
      status: 'reactivated',
      user: {
        email: 'new.user@example.com',
        name: 'New User',
      },
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'user_reactivated',
        actorUserId: 'super-admin-1',
        targetId: 'user-1',
      }),
    )
  })

  it('keeps reactivation successful when notification sending fails', async () => {
    mocks.sendUserStatusNotificationEmail.mockRejectedValue(
      new Error('SES unavailable'),
    )
    const request = buildJsonRequest('/api/users/reactivate', {
      userId: 'user-1',
    })

    const response = await reactivateUserHandler({ request })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      notificationEmailSent: false,
      warning: 'User status changed, but notification email could not be sent.',
    })
    expect(mocks.unbanUser).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'user-1',
      },
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'user_reactivated',
        actorUserId: 'super-admin-1',
        targetId: 'user-1',
      }),
    )
  })

  it('rejects reactivating the super admin account', async () => {
    mocks.getUser.mockResolvedValue({
      ...superAdminUser,
      banned: true,
    })

    const response = await reactivateUserHandler({
      request: buildJsonRequest('/api/users/reactivate', {
        userId: 'super-admin-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'The super admin account cannot be reactivated.',
    })
    expect(mocks.unbanUser).not.toHaveBeenCalled()
    expect(mocks.sendUserStatusNotificationEmail).not.toHaveBeenCalled()
  })
})

describe('/api/users/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.getUser.mockResolvedValue(createdUser)
    mocks.setUserPassword.mockResolvedValue({ ok: true })
    mocks.adminUpdateUser.mockResolvedValue({ ok: true })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('allows admins to reset non-super-admin passwords', async () => {
    const request = buildJsonRequest('/api/users/reset-password', {
      userId: 'user-1',
      newPassword: 'TempPassword1!',
    })

    const response = await resetUserPasswordHandler({ request })

    expect(response.status).toBe(200)
    expect(mocks.setUserPassword).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'user-1',
        newPassword: 'TempPassword1!',
      },
    })
    expect(mocks.adminUpdateUser).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'user-1',
        data: {
          mustChangePassword: true,
        },
      },
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'user_password_reset',
        actorUserId: 'admin-1',
        targetId: 'user-1',
      }),
    )
  })

  it('rejects admins resetting the super admin password', async () => {
    mocks.getUser.mockResolvedValue(superAdminUser)

    const response = await resetUserPasswordHandler({
      request: buildJsonRequest('/api/users/reset-password', {
        userId: 'super-admin-1',
        newPassword: 'TempPassword1!',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Only the super admin can reset the super admin password.',
    })
    expect(mocks.setUserPassword).not.toHaveBeenCalled()
    expect(mocks.adminUpdateUser).not.toHaveBeenCalled()
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })

  it('allows the super admin to reset their own password', async () => {
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'super-admin-1',
      role: 'super_admin',
    })
    mocks.getUser.mockResolvedValue(superAdminUser)
    const request = buildJsonRequest('/api/users/reset-password', {
      userId: 'super-admin-1',
      newPassword: 'TempPassword1!',
    })

    const response = await resetUserPasswordHandler({ request })

    expect(response.status).toBe(200)
    expect(mocks.setUserPassword).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'super-admin-1',
        newPassword: 'TempPassword1!',
      },
    })
    expect(mocks.adminUpdateUser).toHaveBeenCalledWith({
      headers: request.headers,
      body: {
        userId: 'super-admin-1',
        data: {
          mustChangePassword: true,
        },
      },
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'user_password_reset',
        actorUserId: 'super-admin-1',
        targetId: 'super-admin-1',
      }),
    )
  })
})

describe('deleted user mutation guards', () => {
  const deletedMutationCases: Array<{
    label: string
    callHandler: () => Promise<Response>
    assertNoop: () => void
  }> = [
    {
      label: 'update',
      callHandler: () =>
        updateUserHandler({
          request: buildJsonRequest('/api/users/update', {
            userId: 'user-1',
            role: 'viewer',
          }),
        }),
      assertNoop: () => {
        expect(mocks.setRole).not.toHaveBeenCalled()
        expect(mocks.adminUpdateUser).not.toHaveBeenCalled()
      },
    },
    {
      label: 'reset password',
      callHandler: () =>
        resetUserPasswordHandler({
          request: buildJsonRequest('/api/users/reset-password', {
            userId: 'user-1',
            newPassword: 'TempPassword1!',
          }),
        }),
      assertNoop: () => {
        expect(mocks.setUserPassword).not.toHaveBeenCalled()
        expect(mocks.adminUpdateUser).not.toHaveBeenCalled()
      },
    },
    {
      label: 'deactivate',
      callHandler: () =>
        deactivateUserHandler({
          request: buildJsonRequest('/api/users/deactivate', {
            userId: 'user-1',
          }),
        }),
      assertNoop: () => {
        expect(mocks.banUser).not.toHaveBeenCalled()
        expect(mocks.sendUserStatusNotificationEmail).not.toHaveBeenCalled()
      },
    },
    {
      label: 'reactivate',
      callHandler: () =>
        reactivateUserHandler({
          request: buildJsonRequest('/api/users/reactivate', {
            userId: 'user-1',
          }),
        }),
      assertNoop: () => {
        expect(mocks.unbanUser).not.toHaveBeenCalled()
        expect(mocks.sendUserStatusNotificationEmail).not.toHaveBeenCalled()
      },
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.requireSuperAdminContext.mockResolvedValue({
      userId: 'super-admin-1',
      role: 'super_admin',
    })
    mocks.getUser.mockResolvedValue(deletedUser)
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it.each(deletedMutationCases)(
    'rejects $label for a deleted user',
    async ({ callHandler, assertNoop }) => {
      const response = await callHandler()

      expect(response.status).toBe(400)
      await expect(readJson(response)).resolves.toEqual({
        error: 'This user has been deleted.',
      })
      assertNoop()
    },
  )
})

describe('/api/users/resend-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.getUser.mockResolvedValue(createdUser)
    mocks.sendVerificationEmail.mockResolvedValue({ status: true })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires an admin session', async () => {
    mocks.requireAdminContext.mockResolvedValue(null)

    const response = await resendVerificationHandler({
      request: buildJsonRequest('/api/users/resend-verification', {
        userId: 'user-1',
      }),
    })

    expect(response.status).toBe(401)
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it('resends verification only through the unauthenticated Better Auth endpoint', async () => {
    const request = buildJsonRequest('/api/users/resend-verification', {
      userId: 'user-1',
    })

    const response = await resendVerificationHandler({ request })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      ok: true,
      verificationEmailSent: true,
    })
    expect(mocks.getUser).toHaveBeenCalledWith({
      headers: request.headers,
      query: {
        id: 'user-1',
      },
    })
    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      body: {
        email: 'new.user@example.com',
        callbackURL: '/login',
      },
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'user_verification_email_resent',
        actorUserId: 'admin-1',
        targetId: 'user-1',
      }),
    )
  })

  it('rejects already verified users', async () => {
    mocks.getUser.mockResolvedValue({
      ...createdUser,
      emailVerified: true,
    })

    const response = await resendVerificationHandler({
      request: buildJsonRequest('/api/users/resend-verification', {
        userId: 'user-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'This user is already verified.',
    })
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('rejects deactivated users', async () => {
    mocks.getUser.mockResolvedValue({
      ...createdUser,
      banned: true,
    })

    const response = await resendVerificationHandler({
      request: buildJsonRequest('/api/users/resend-verification', {
        userId: 'user-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Reactivate this user before resending verification email.',
    })
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('rejects deleted users', async () => {
    mocks.getUser.mockResolvedValue(deletedUser)

    const response = await resendVerificationHandler({
      request: buildJsonRequest('/api/users/resend-verification', {
        userId: 'user-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'This user has been deleted.',
    })
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
  })
})
