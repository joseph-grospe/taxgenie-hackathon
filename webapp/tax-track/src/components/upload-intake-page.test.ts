import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { UPLOAD_TOUR_TARGETS } from '@/lib/product-tours'

const uploadIntakePageSource = readFileSync(
  new URL('./upload-intake-page.tsx', import.meta.url),
  'utf8',
)

describe('UploadIntakePage product tour contract', () => {
  it('uses every upload tour target in the page component', () => {
    for (const targetName of Object.keys(UPLOAD_TOUR_TARGETS)) {
      expect(uploadIntakePageSource).toContain(
        `UPLOAD_TOUR_TARGETS.${targetName}`,
      )
    }
  })

  it('includes contextual help labels for upload-specific decisions', () => {
    expect(uploadIntakePageSource).toContain('Entity upload help')
    expect(uploadIntakePageSource).toContain('Upload rules help')
    expect(uploadIntakePageSource).toContain('Certificate status table help')
    expect(uploadIntakePageSource).toContain('Close batch help')
  })
})
