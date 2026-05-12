import { beforeEach, describe, expect, it, vi } from 'vitest'

import { atcCodes } from '@/lib/schema'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}))

import {
  importAtcCodesCsvFile,
  isCsvFileUpload,
  normalizeAtcCode,
  parseAtcCodesCsv,
  replaceAtcCodeRows,
} from '@/lib/atc-codes-server'

const referenceCsv = `Tax Type,ATC,Description,Tax Rate
WE,WC160,Income Payment made by top withholding agents to their local/resident suppliers of services other than those covered by other rates of withholding tax,2%
WE,WC158,Income Payment made by top withholding agents to their local/resident suppliers of goods other than those covered by other rates of withholding tax,1%
WE,WC051,Management and technical consultants,15%
WE,WC630,"Income payments on purchases of minerals, mineral products and quarry resources, such as but not limited to silver, gold, granite, gravel, sand, boulders and other mineral products except purchases by Bangko Sentral ng Pilipinas",5%
WE,WC100,"Rentals: On gross rental or lease for the continued use or possession of personal property in excess of \u20b1 10,000.00 annually and real property used in business which the payor or obligor has not taken title or is not taking title, or in which has no equity; poles, satellites, transmission facilities and billboards",5%
WE,WC120,Income payments to certain contractors,2%
WE,WC157 ,"Income Payment made by NGAs, LGU, & etc to its local/resident suppliers of services other than those covered by other rates of withholding tax",2%`

describe('atc-codes-server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses the reference CSV shape and rates', () => {
    const rows = parseAtcCodesCsv(referenceCsv)

    expect(rows).toHaveLength(7)
    expect(rows.map((row) => [row.code, row.rate])).toEqual([
      ['WC160', 0.02],
      ['WC158', 0.01],
      ['WC051', 0.15],
      ['WC630', 0.05],
      ['WC100', 0.05],
      ['WC120', 0.02],
      ['WC157', 0.02],
    ])
    expect(rows[0]).toEqual(
      expect.objectContaining({
        taxType: 'WE',
        code: 'WC160',
        description:
          'Income Payment made by top withholding agents to their local/resident suppliers of services other than those covered by other rates of withholding tax',
      }),
    )
  })

  it('normalizes ATC codes by trimming and removing punctuation', () => {
    expect(normalizeAtcCode(' wc-157 ')).toBe('WC157')
  })

  it('rejects duplicate normalized ATC codes', () => {
    expect(() =>
      parseAtcCodesCsv(`Tax Type,ATC,Description,Tax Rate
WE,WC160,Services,2%
WE,wc-160,Duplicate services,2%`),
    ).toThrow('CSV contains duplicate ATC code: WC160.')
  })

  it('rejects missing required headers', () => {
    expect(() =>
      parseAtcCodesCsv(`Tax Type,ATC,Description
WE,WC160,Services`),
    ).toThrow('CSV is missing required headers: Tax Rate.')
  })

  it('rejects blank ATC codes and invalid rates', () => {
    expect(() =>
      parseAtcCodesCsv(`Tax Type,ATC,Description,Tax Rate
WE,,Services,2%`),
    ).toThrow('ATC code is required.')

    expect(() =>
      parseAtcCodesCsv(`Tax Type,ATC,Description,Tax Rate
WE,WC160,Services,0%`),
    ).toThrow('Tax rate must be positive for ATC WC160.')
  })

  it('rejects empty file content', () => {
    expect(() => parseAtcCodesCsv(' \n')).toThrow('CSV file is empty.')
  })

  it('accepts only csv file names for uploads', () => {
    expect(isCsvFileUpload({ name: 'ATCs.xlsx - ATC Codes.csv' })).toBe(true)
    expect(isCsvFileUpload({ name: 'atc-codes.xlsx' })).toBe(false)
  })

  it('replaces existing ATC rows before inserting imported rows', async () => {
    const deleteMock = vi.fn().mockResolvedValue(undefined)
    const valuesMock = vi.fn().mockResolvedValue(undefined)
    const insertMock = vi.fn(() => ({
      values: valuesMock,
    }))
    const transactionMock = vi.fn(async (callback) =>
      callback({
        delete: deleteMock,
        insert: insertMock,
      }),
    )

    getDbMock.mockReturnValue({
      transaction: transactionMock,
    })

    const rows = parseAtcCodesCsv(`Tax Type,ATC,Description,Tax Rate
WE,wc-630,Minerals,5%`)

    await expect(replaceAtcCodeRows(rows)).resolves.toBe(1)
    expect(deleteMock).toHaveBeenCalledWith(atcCodes)
    expect(insertMock).toHaveBeenCalledWith(atcCodes)
    expect(valuesMock).toHaveBeenCalledWith([
      {
        taxType: 'WE',
        code: 'WC630',
        description: 'Minerals',
        rate: 0.05,
      },
    ])
  })

  it('rejects non-csv uploads before reading the file content', async () => {
    const text = vi.fn()

    await expect(
      importAtcCodesCsvFile({
        name: 'atc-codes.xlsx',
        text,
      }),
    ).rejects.toThrow('Only CSV files are supported.')

    expect(text).not.toHaveBeenCalled()
  })
})
