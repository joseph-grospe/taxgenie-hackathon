import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const candidateEnvPaths = [
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '.env'),
]
const loadedEnvValues = new Map<string, string>()
for (const candidatePath of candidateEnvPaths) {
  if (!existsSync(candidatePath)) {
    continue
  }

  const envContent = readFileSync(candidatePath, 'utf8')
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
    if (key) {
      loadedEnvValues.set(key, value)
    }
  }
}

for (const [key, value] of loadedEnvValues) {
  if (!(key in process.env)) {
    process.env[key] = value
  }
}

const config = defineConfig({
  server: {
    allowedHosts: [
      'https://arizona-controls-edward-registrar.trycloudflare.com',
      'arizona-controls-edward-registrar.trycloudflare.com',
    ],
  },
  resolve: {
    alias: {
      'pg-native': path.resolve(
        __dirname,
        './src/lib/server-shims/pg-native.cjs',
      ),
      'react/jsx-dev-runtime': path.resolve(
        __dirname,
        './src/lib/server-shims/react-jsx-dev-runtime.ts',
      ),
    },
  },
  plugins: [
    // devtools(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    nitro({
      preset: 'aws-lambda',
      awsLambda: {
        streaming: true,
      },
    }),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
