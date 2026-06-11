import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8')

describe('/reconciliation/$rowId route source', () => {
  it('places the Back button in AppShell leadingActions', () => {
    const source = readSource('src/routes/reconciliation.$rowId.tsx')

    expect(source).toContain('leadingActions={<BackToReconciliationButton />}')
    expect(source).not.toContain('actions={<BackToReconciliationButton />}')
    expect(source).not.toMatch(/actions=\{\s*<Button[\s\S]*Back/)
  })
})
