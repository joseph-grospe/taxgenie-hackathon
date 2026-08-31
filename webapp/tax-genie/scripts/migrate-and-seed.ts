import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveDatabaseConnectionConfig } from '@taxgenie/shared'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))
const migrationsFolder = resolve(scriptDirectory, '../src/lib/migrations')

const pool = new Pool({
  ...resolveDatabaseConnectionConfig(process.env),
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 5_000,
  allowExitOnIdle: true,
})

try {
  console.info('Applying canonical TaxGenie web migrations.')
  await migrate(drizzle(pool), { migrationsFolder })

  const { ensureSeedAdminUser } = await import('../src/lib/auth-server')
  await ensureSeedAdminUser()
  console.info('Migrations complete and the seed administrator is available.')
} finally {
  await pool.end()
}
