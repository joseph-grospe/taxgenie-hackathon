import { createAccessControl, role } from 'better-auth/plugins/access'
import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins/admin'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { eq } from 'drizzle-orm'

import { authDbAdapter, getDb } from '@/lib/db'
import { logAuditEvent } from '@/lib/audit'
import { authUserTable } from '@/lib/schema'

type HookContext = {
  path?: string
  request?: Request
  context?: {
    returned?: unknown
    [key: string]: unknown
  }
  body?: {
    email?: unknown
  }
}

const normalizeOrigin = (value: string | undefined | null): string | undefined => {
  if (!value) {
    return undefined
  }

  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

const getFirstHeaderValue = (
  headers: Headers,
  name: string,
): string | undefined => {
  const value = headers.get(name)
  return value?.split(',')[0]?.trim() || undefined
}

const addOrigin = (
  origins: Set<string>,
  value: string | undefined | null,
): void => {
  const origin = normalizeOrigin(value)
  if (origin) {
    origins.add(origin)
  }
}

const getConfiguredTrustedOrigins = (): string[] => {
  const origins = new Set<string>()

  addOrigin(origins, process.env.BETTER_AUTH_URL)

  const rawTrustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  if (rawTrustedOrigins) {
    for (const value of rawTrustedOrigins.split(',')) {
      addOrigin(origins, value.trim())
    }
  }

  return Array.from(origins)
}

const getRequestTrustedOrigins = (request: Request): string[] => {
  const origins = new Set<string>()
  const requestUrl = new URL(request.url)
  const headers = request.headers

  addOrigin(origins, requestUrl.origin)

  const forwardedProto =
    getFirstHeaderValue(headers, 'x-forwarded-proto') ?? requestUrl.protocol.replace(/:$/, '')
  const forwardedHost = getFirstHeaderValue(headers, 'x-forwarded-host')
  if (forwardedHost) {
    addOrigin(origins, `${forwardedProto}://${forwardedHost}`)
  }

  const host = getFirstHeaderValue(headers, 'host')
  if (host) {
    addOrigin(origins, `${forwardedProto}://${host}`)
  }

  return Array.from(origins)
}

const rolePermissions = {
  user: [
    'create',
    'list',
    'set-role',
    'ban',
    'impersonate',
    'delete',
    'set-password',
    'get',
    'update',
  ],
  session: ['list', 'revoke', 'delete'],
} as const

const editorViewerPermissions = {
  user: ['list'],
  session: [],
} as const

const adminAccessControl = createAccessControl({
  user: rolePermissions.user,
  session: rolePermissions.session,
})

const adminPluginDefaults = {
  roles: {
    admin: role(rolePermissions),
    editor: role(editorViewerPermissions),
    viewer: role(editorViewerPermissions),
  },
  ac: adminAccessControl,
  defaultRole: 'viewer',
  adminRoles: ['admin'],
}

const isLoginEndpoint = (path: string) => {
  return path === '/sign-in' || path === '/sign-in/email'
}

const isFailureResponse = (returned: unknown): boolean => {
  return (
    returned === null ||
    returned === false ||
    !!returned &&
    typeof returned === 'object' &&
    'error' in returned
  )
}

const getAuditActorUserId = (returned: unknown): string | undefined => {
  if (!returned || typeof returned !== 'object') {
    return undefined
  }

  const user = returned as {
    user?: {
      id?: unknown
    }
  }

  return typeof user.user?.id === 'string' ? user.user.id : undefined
}

const getAuditAttemptedEmail = (body: unknown): string | undefined => {
  if (!body || typeof body !== 'object') {
    return undefined
  }

  const email = (body as { email?: unknown }).email

  return typeof email === 'string' ? email : undefined
}

const isDuplicateUserError = (error: unknown): boolean => {
  if (error instanceof Error) {
    return error.message.toLowerCase().includes('already exists')
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message.toLowerCase().includes('already exists')
  }

  return false
}

export const auth = betterAuth({
  appName: 'TaxTrack',
  basePath: '/api/auth',
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: async (request) => {
    const origins = new Set<string>(getConfiguredTrustedOrigins())

    for (const origin of getRequestTrustedOrigins(request)) {
      origins.add(origin)
    }

    return Array.from(origins)
  },
  secret: process.env.BETTER_AUTH_SECRET,
  database: authDbAdapter(),
  hooks: {
    after: async (rawContext) => {
      const context = rawContext as HookContext
      const path = context.path ?? ''

      if (!isLoginEndpoint(path)) {
        return {}
      }

      const request = context.request
      if (!(request instanceof Request)) {
        return {}
      }

      const returned = context.context?.returned
      const actorUserId = getAuditActorUserId(returned)
      const attemptedEmail = getAuditAttemptedEmail(context.body)

      if (isFailureResponse(returned)) {
        await logAuditEvent(request, {
          eventType: 'login_failed',
          actorUserId,
          metadata: {
            attemptedEmail,
            path,
          },
        }).catch(() => undefined)
      } else {
        await logAuditEvent(request, {
          eventType: 'login_succeeded',
          actorUserId,
          targetUserId: actorUserId,
          metadata: {
            path,
          },
        }).catch(() => undefined)
      }

      return {}
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7,
    },
    storeSessionInDatabase: true,
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 12,
  },
  user: {
    additionalFields: {
      team: {
        type: 'string',
        input: false,
        required: true,
        defaultValue: 'it',
      },
      mustChangePassword: {
        type: 'boolean',
        input: false,
        required: false,
        defaultValue: false,
      },
      canExportPdf: {
        type: 'boolean',
        input: false,
        required: false,
        defaultValue: false,
      },
      canExportExcel: {
        type: 'boolean',
        input: false,
        required: false,
        defaultValue: false,
      },
    },
  },
  plugins: [admin(adminPluginDefaults), tanstackStartCookies()],
})

let seedPromise: Promise<void> | null = null

const createSeedAdminRole = async () => {
  const seedEmail = process.env.TAXTRACK_SEED_EMAIL?.trim()
  const seedPassword = process.env.TAXTRACK_SEED_PASSWORD?.trim()

  if (!seedEmail || !seedPassword) {
    return
  }

  const db = getDb()
  const existingUser = await db
    .select({ id: authUserTable.id })
    .from(authUserTable)
    .where(eq(authUserTable.email, seedEmail))
    .limit(1)

  if (existingUser.length > 0) {
    return
  }

  const seedName = process.env.TAXTRACK_SEED_NAME?.trim() || 'TaxTrack Admin'

  await auth.api.createUser({
    body: {
      email: seedEmail,
      password: seedPassword,
      name: seedName,
      role: 'admin',
      data: {
        team: 'other',
        mustChangePassword: false,
        canExportPdf: true,
        canExportExcel: true,
      },
    },
  })
}

export const ensureSeedAdminUser = async () => {
  if (seedPromise) {
    return seedPromise
  }

  seedPromise = (async () => {
    try {
      await createSeedAdminRole()
    } catch (error: unknown) {
      if (!isDuplicateUserError(error)) {
        seedPromise = null
        throw error
      }
    }
  })()

  return seedPromise
}
