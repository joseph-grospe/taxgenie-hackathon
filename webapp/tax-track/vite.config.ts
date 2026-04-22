import path from 'node:path'

import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
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
      preset: "aws-lambda",
      awsLambda: {
        streaming: true,
      },
    }),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
