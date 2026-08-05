import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const baselineMigration = readFileSync(
  new URL('./0000_baseline.sql', import.meta.url),
  'utf8',
)
const primaryAtcTotalsMigration = readFileSync(
  new URL('./0002_fill_primary_atc_totals.sql', import.meta.url),
  'utf8',
)

describe('squashed baseline certificate projection', () => {
  it('creates the existing Drizzle view used by dashboard and document queries', () => {
    expect(baselineMigration).toContain(
      'CREATE OR REPLACE VIEW "certificate_results_view" AS',
    )
    expect(baselineMigration).toContain(
      '"document_result"."payload" -> \'extraction\' -> \'certificates\'',
    )
    expect(baselineMigration).toContain(
      'LEFT JOIN LATERAL (\n\tSELECT "artifact"."key"',
    )
  })
})

describe('primary ATC totals backfill', () => {
  it('fills only missing totals from complete rows matching primary_atc_code', () => {
    expect(primaryAtcTotalsMigration).toContain(
      `upper(coalesce("tax_row"."atc_code", ''))`,
    )
    expect(primaryAtcTotalsMigration).toContain(
      `upper(coalesce("certificate"."primary_atc_code", ''))`,
    )
    expect(primaryAtcTotalsMigration).toContain(
      'count(*) = count("tax_row"."tax_base")',
    )
    expect(primaryAtcTotalsMigration).toContain(
      'count(*) = count("tax_row"."tax_withheld")',
    )
    expect(primaryAtcTotalsMigration).toContain(
      'coalesce(\n\t\t"certificate"."total_tax_base"',
    )
    expect(primaryAtcTotalsMigration).toContain(
      'coalesce(\n\t\t"certificate"."total_tax_withheld"',
    )
  })
})
