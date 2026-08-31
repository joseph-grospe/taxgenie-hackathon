import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = join(appRoot, '.output', 'server')
const publicDir = join(appRoot, '.output', 'public')
const manifestFiles = readdirSync(serverDir).filter((fileName) =>
  fileName.startsWith('_tanstack-start-manifest_'),
)

if (manifestFiles.length === 0) {
  throw new Error('TanStack Start build manifest was not generated.')
}

const stylesheetReferences = new Set()
for (const manifestFile of manifestFiles) {
  const manifest = readFileSync(join(serverDir, manifestFile), 'utf8')
  for (const match of manifest.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.css/gu)) {
    stylesheetReferences.add(match[0])
  }
}

if (stylesheetReferences.size === 0) {
  throw new Error('The server manifest does not reference a stylesheet.')
}

const missingStylesheets = [...stylesheetReferences].filter(
  (assetPath) => !existsSync(join(publicDir, assetPath)),
)

if (missingStylesheets.length > 0) {
  throw new Error(
    `Server manifest references missing stylesheets: ${missingStylesheets.join(', ')}`,
  )
}

console.log(
  `Verified ${stylesheetReferences.size} server stylesheet asset(s) in .output/public.`,
)
