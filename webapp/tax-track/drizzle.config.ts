import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Config } from 'drizzle-kit'

const candidateEnvPaths = [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')]
const envPath = candidateEnvPaths.find((path) => existsSync(path))
if (envPath) {
  const envContent = readFileSync(envPath, 'utf8')
  const lines = envContent.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    const key = trimmed.slice(0, separatorIndex)
    const value = trimmed.slice(separatorIndex + 1).replace(/^["']|["']$/g, '')
    if (key && !(key in process.env)) {
      process.env[key] = value
    }
  }
}

export default {
  schema: './src/lib/schema.ts',
  out: './src/lib/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
} satisfies Config
