import { describe, expect, it } from 'vitest'

import {
  MERGE_PART_SIZE_LIMIT_BYTES,
  buildCertificateMergeFileName,
  getCertificateMergePeriodRange,
  partitionCertificateMergeInputs,
  sortCertificateMergeInputsByPayorName,
} from '@taxtrack/shared'

describe('certificate merge helpers', () => {
  it('builds quarterly and annual EAFS filenames', () => {
    expect(
      buildCertificateMergeFileName(
        '004-760-842',
        { type: 'quarterly', year: 2024, quarter: 1 },
        1,
      ),
    ).toBe('EAFS004760842TCR1Q122024-01.pdf')

    expect(
      buildCertificateMergeFileName(
        '004760842',
        { type: 'annual', year: 2024 },
        3,
      ),
    ).toBe('EAFS004760842TCRTY122024-03.pdf')
  })

  it('uses the first 9 entity TIN digits for filenames', () => {
    expect(
      buildCertificateMergeFileName(
        '004-760-842-000',
        { type: 'annual', year: 2024 },
        1,
      ),
    ).toBe('EAFS004760842TCRTY122024-01.pdf')
  })

  it('rejects entity TINs with fewer than 9 digits', () => {
    expect(() =>
      buildCertificateMergeFileName(
        '004-760',
        { type: 'annual', year: 2024 },
        1,
      ),
    ).toThrow('at least 9 digits')
  })

  it('rejects output part numbers outside 01 to 03', () => {
    expect(() =>
      buildCertificateMergeFileName(
        '004760842',
        { type: 'annual', year: 2024 },
        0,
      ),
    ).toThrow('between 1 and 3')

    expect(() =>
      buildCertificateMergeFileName(
        '004760842',
        { type: 'annual', year: 2024 },
        4,
      ),
    ).toThrow('between 1 and 3')
  })

  it('maps annual and quarterly periods to half-open date ranges', () => {
    expect(
      getCertificateMergePeriodRange({ type: 'annual', year: 2024 }),
    ).toEqual({
      startDate: '2024-01-01',
      endDate: '2025-01-01',
    })
    expect(
      getCertificateMergePeriodRange({
        type: 'quarterly',
        year: 2024,
        quarter: 4,
      }),
    ).toEqual({
      startDate: '2024-10-01',
      endDate: '2025-01-01',
    })
  })

  it('partitions signed PDFs into three capped merge outputs', () => {
    const inputs = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `input-${index}`,
        sizeBytes: 1_600_000_000,
      })),
      {
        id: 'input-6',
        sizeBytes: 400_000_000,
      },
    ]

    const parts = partitionCertificateMergeInputs(inputs)

    expect(parts).toHaveLength(3)
    expect(parts.map((part) => part.sizeBytes)).toEqual([
      MERGE_PART_SIZE_LIMIT_BYTES,
      MERGE_PART_SIZE_LIMIT_BYTES,
      400_000_000,
    ])
    expect(parts.map((part) => part.inputs.length)).toEqual([3, 3, 1])
  })

  it('keeps under-limit and exactly-limit selections in one output', () => {
    expect(
      partitionCertificateMergeInputs([
        { id: 'input-1', sizeBytes: 2_000_000_000 },
        { id: 'input-2', sizeBytes: 2_000_000_000 },
      ]),
    ).toMatchObject([{ partNumber: 1, sizeBytes: 4_000_000_000 }])

    expect(
      partitionCertificateMergeInputs([
        { id: 'input-1', sizeBytes: MERGE_PART_SIZE_LIMIT_BYTES },
      ]),
    ).toMatchObject([{ partNumber: 1, sizeBytes: MERGE_PART_SIZE_LIMIT_BYTES }])
  })

  it('rejects selections needing more than three outputs', () => {
    const inputs = Array.from({ length: 10 }, (_, index) => ({
      id: `input-${index}`,
      sizeBytes: 1_600_000_000,
    }))

    expect(() => partitionCertificateMergeInputs(inputs)).toThrow(
      'three-file merge limit',
    )
  })

  it('sorts merge inputs by payor name with numeric-leading names naturally', () => {
    const sorted = sortCertificateMergeInputsByPayorName([
      {
        id: 'alpha',
        payorName: 'Alpha Trading Corp.',
        originalFileName: 'alpha.pdf',
      },
      {
        id: 'two',
        payorName: '2GO Express, Inc.',
        originalFileName: 'two.pdf',
      },
      {
        id: 'missing',
        payorName: '',
        originalFileName: 'missing.pdf',
      },
      {
        id: 'ten',
        payorName: '10K Contractors',
        originalFileName: 'ten.pdf',
      },
      {
        id: 'abc',
        payorName: 'ABC Holdings',
        originalFileName: 'abc.pdf',
      },
      {
        id: 'one',
        payorName: '1 Source Business',
        originalFileName: 'one.pdf',
      },
    ])

    expect(sorted.map((input) => input.id)).toEqual([
      'one',
      'two',
      'ten',
      'abc',
      'alpha',
      'missing',
    ])
  })
})
