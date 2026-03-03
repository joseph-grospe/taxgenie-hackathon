import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

import { schema } from '@/lib/schema'

type TaxTrackDatabase = NodePgDatabase<typeof schema>

const createPool = () => {
  const databaseUrl = process.env.DATABASE_URL?.trim()

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for webapp authentication storage')
  }

  return new Pool({
    connectionString: databaseUrl,
  })
}

type GlobalRuntimeState = {
  __taxTrackPool?: ReturnType<typeof createPool>
  __taxTrackDrizzle?: TaxTrackDatabase
}

const globalState = globalThis as typeof globalThis & GlobalRuntimeState

const getPool = () => {
  if (!globalState.__taxTrackPool) {
    globalState.__taxTrackPool = createPool()
  }

  return globalState.__taxTrackPool
}

const getAdapter = () => {
  return drizzleAdapter(getDb(), {
    provider: 'pg',
    schema,
    debugLogs: process.env.NODE_ENV === 'development',
  })
}

export const getDb = () => {
  if (!globalState.__taxTrackDrizzle) {
    globalState.__taxTrackDrizzle = drizzle(getPool(), {
      schema,
      logger: process.env.NODE_ENV === 'development',
    })
  }

  return globalState.__taxTrackDrizzle
}

export const authDbAdapter = () => getAdapter()

export { schema }
