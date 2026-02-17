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
  emailAndPassword: {
    enabled: true,
  },
  plugins: [tanstackStartCookies()],
})
