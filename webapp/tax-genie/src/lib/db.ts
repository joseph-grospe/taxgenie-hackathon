import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'

import { schema } from '@/lib/schema'

type TaxGenieDatabase = NodePgDatabase<typeof schema>

const shouldUseSsl = (databaseUrl: string) => {
  const hostname = new URL(databaseUrl).hostname

  return !['localhost', '127.0.0.1', '::1'].includes(hostname)
}

const parseIntegerEnv = (name: string, fallback: number) => {
  const rawValue = process.env[name]?.trim()
  if (!rawValue) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const toNodePgConnectionString = (databaseUrl: string) => {
  const connectionUrl = new URL(databaseUrl)

  connectionUrl.searchParams.delete('sslmode')
  connectionUrl.searchParams.delete('sslcert')
  connectionUrl.searchParams.delete('sslkey')
  connectionUrl.searchParams.delete('sslrootcert')

  return connectionUrl.toString()
}

const createPool = () => {
  const databaseUrl = process.env.DATABASE_URL?.trim()

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for webapp authentication storage')
  }

  const pool = new Pool({
    connectionString: toNodePgConnectionString(databaseUrl),
    max: parseIntegerEnv('PG_POOL_MAX', 4),
    connectionTimeoutMillis: parseIntegerEnv('PG_CONNECTION_TIMEOUT_MS', 5_000),
    idleTimeoutMillis: parseIntegerEnv('PG_IDLE_TIMEOUT_MS', 10_000),
    maxLifetimeSeconds: parseIntegerEnv('PG_MAX_LIFETIME_SECONDS', 60),
    query_timeout: parseIntegerEnv('PG_QUERY_TIMEOUT_MS', 10_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    allowExitOnIdle: true,
    ssl: shouldUseSsl(databaseUrl)
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  })

  pool.on('error', (error) => {
    console.error('Unexpected Postgres pool error in webapp auth runtime.', error)
  })

  return pool
}

type GlobalRuntimeState = {
  __taxGeniePool?: ReturnType<typeof createPool>
  __taxGenieDrizzle?: TaxGenieDatabase
}

const globalState = globalThis as typeof globalThis & GlobalRuntimeState

const getPool = () => {
  if (!globalState.__taxGeniePool) {
    globalState.__taxGeniePool = createPool()
  }

  return globalState.__taxGeniePool
}

const getAdapter = () => {
  return drizzleAdapter(getDb(), {
    provider: 'pg',
    schema,
    debugLogs: process.env.NODE_ENV === 'development',
  })
}

export const getDb = () => {
  if (!globalState.__taxGenieDrizzle) {
    globalState.__taxGenieDrizzle = drizzle(getPool(), {
      schema,
      logger: process.env.NODE_ENV === 'development',
    })
  }

  return globalState.__taxGenieDrizzle
}

export const authDbAdapter = () => getAdapter()

export { schema }
