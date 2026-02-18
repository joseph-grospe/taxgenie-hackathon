import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import type { MemoryDB } from 'better-auth/adapters/memory'

const globalAuthState = globalThis as typeof globalThis & {
  __taxTrackAuthDb?: MemoryDB
}

const memoryDb = globalAuthState.__taxTrackAuthDb ?? {}
for (const model of ['user', 'session', 'account', 'verification']) {
  if (!Array.isArray(memoryDb[model])) {
    memoryDb[model] = []
  }
}
globalAuthState.__taxTrackAuthDb = memoryDb

export const auth = betterAuth({
  appName: 'TaxTrack',
  basePath: '/api/auth',
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: memoryAdapter(memoryDb),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7,
    },
    storeSessionInDatabase: false,
  },
  emailAndPassword: {
    enabled: true,
  },
  plugins: [tanstackStartCookies()],
})

let seedPromise: Promise<void> | null = null

export const ensureSeedAdminUser = async () => {
  if (seedPromise) {
    return seedPromise
  }

  seedPromise = (async () => {
    const seedEmail = process.env.TAXTRACK_SEED_EMAIL?.trim()
    const seedPassword = process.env.TAXTRACK_SEED_PASSWORD?.trim()

    if (!seedEmail || !seedPassword) {
      return
    }

    const seedName = process.env.TAXTRACK_SEED_NAME?.trim() || 'TaxTrack Admin'

    try {
      await auth.api.signUpEmail({
        body: {
          email: seedEmail,
          password: seedPassword,
          name: seedName,
        },
      })
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String(error.message)
            : ''
      if (!message.toLowerCase().includes('already exists')) {
        console.error('Failed to create seeded admin account', error)
        seedPromise = null
        throw error
      }
    }
  })()

  return seedPromise
}
