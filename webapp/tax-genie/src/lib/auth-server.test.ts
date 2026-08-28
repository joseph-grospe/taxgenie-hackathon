import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: vi.fn((options: unknown) => ({ id: 'admin', options })),
  authDbAdapter: vi.fn(() => ({ adapter: true })),
  betterAuth: vi.fn((options: unknown) => ({
    api: {
      createUser: vi.fn(),
    },
    handler: vi.fn(),
    options,
  })),
  createAccessControl: vi.fn((options: unknown) => options),
  getDb: vi.fn(),
  logAuditEvent: vi.fn(),
  role: vi.fn((options: unknown) => options),
  sendAuthVerificationEmail: vi.fn(),
  tanstackStartCookies: vi.fn(() => ({ id: 'tanstack-start-cookies' })),
}))

vi.mock('better-auth', () => ({
  betterAuth: mocks.betterAuth,
}))

vi.mock('better-auth/plugins/access', () => ({
  createAccessControl: mocks.createAccessControl,
  role: mocks.role,
}))

vi.mock('better-auth/plugins/admin', () => ({
  admin: mocks.admin,
}))

vi.mock('better-auth/tanstack-start', () => ({
  tanstackStartCookies: mocks.tanstackStartCookies,
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/auth-email-server', () => ({
  sendAuthVerificationEmail: mocks.sendAuthVerificationEmail,
}))

vi.mock('@/lib/db', () => ({
  authDbAdapter: mocks.authDbAdapter,
  getDb: mocks.getDb,
}))

vi.mock('@/lib/schema', () => ({
  authUserTable: {
    email: 'email',
    id: 'id',
  },
}))

await import('@/lib/auth-server')

describe('auth-server', () => {
  it('configures Better Auth to require email verification before sign-in', () => {
    const options = mocks.betterAuth.mock.calls[0]?.[0] as {
      emailAndPassword?: Record<string, unknown>
      emailVerification?: Record<string, unknown>
    }

    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
    })
    expect(options.emailVerification).toMatchObject({
      expiresIn: 60 * 60 * 24,
      sendOnSignUp: false,
      sendOnSignIn: true,
    })
    expect(options.emailVerification?.sendVerificationEmail).toBe(
      mocks.sendAuthVerificationEmail,
    )
  })
})
