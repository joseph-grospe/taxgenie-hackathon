import { beforeEach, describe, expect, it, vi } from 'vitest'

import { entities } from '@/lib/schema'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}))

import {
  importEntitiesCsvFile,
  isCsvFileUpload,
  parseEntitiesCsv,
  replaceEntityRows,
} from '@/lib/entities-server'

describe('entities-server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts the sample CSV shape and maps REGION to regionEmailAddress', () => {
    const rows = parseEntitiesCsv(`Short  Name ,Company Name ,BIR Registered Address,ZIP Code ,TIN,EMAIL ADDRESS,REGION
TMO ,"THERMA MOBILE, INC.",Old Veco Compound Ermita (Pob) 6000 Cebu City (Capital) Cebu Philippines,6000,266-566-116-00000,seph.grospe@gmail.com,joseph.grospe080698@gmail.com`)

    expect(rows).toEqual([
      {
        shortName: 'TMO',
        companyName: 'THERMA MOBILE, INC.',
        birRegisteredAddress:
          'Old Veco Compound Ermita (Pob) 6000 Cebu City (Capital) Cebu Philippines',
        zipCode: '6000',
        tin: '266-566-116-00000',
        emailAddress: 'seph.grospe@gmail.com',
        regionEmailAddress: 'joseph.grospe080698@gmail.com',
      },
    ])
  })

  it('preserves quoted commas in addresses', () => {
    const rows = parseEntitiesCsv(`Short Name,Company Name,BIR Registered Address,ZIP Code,TIN,EMAIL ADDRESS,REGION
PEC,PAGBILAO ENERGY CORPORATION,"25/F W5TH AVENUE BUILDING 5TH AVENUE, BONIFACIO GLOBAL CITY FORT BONIFACIO, TAGUIG CITY NCR, FOURTH DISTRICT PHILIPPINES 1630",1630,008-275-398-00000,seph.grospe@gmail.com,joseph.grospe080698@gmail.com`)

    expect(rows[0]).toEqual(
      expect.objectContaining({
        birRegisteredAddress:
          '25/F W5TH AVENUE BUILDING 5TH AVENUE, BONIFACIO GLOBAL CITY FORT BONIFACIO, TAGUIG CITY NCR, FOURTH DISTRICT PHILIPPINES 1630',
      }),
    )
  })

  it('skips blank lines and converts empty cells to null', () => {
    const rows = parseEntitiesCsv(`Short Name,Company Name,BIR Registered Address,ZIP Code,TIN,EMAIL ADDRESS,REGION

TMO,THERMA MOBILE INC.,,6000,,,
`)

    expect(rows).toEqual([
      {
        shortName: 'TMO',
        companyName: 'THERMA MOBILE INC.',
        birRegisteredAddress: null,
        zipCode: '6000',
        tin: null,
        emailAddress: null,
        regionEmailAddress: null,
      },
    ])
  })

  it('rejects missing required headers', () => {
    expect(() =>
      parseEntitiesCsv(`Short Name,Company Name,BIR Registered Address,ZIP Code,TIN,EMAIL ADDRESS
TMO,THERMA MOBILE INC.,Cebu,6000,266-566-116-00000,seph.grospe@gmail.com`),
    ).toThrow('CSV is missing required headers: REGION.')
  })

  it('rejects empty file content', () => {
    expect(() => parseEntitiesCsv(' \n')).toThrow('CSV file is empty.')
  })

  it('accepts only csv file names for uploads', () => {
    expect(isCsvFileUpload({ name: 'entities.csv' })).toBe(true)
    expect(isCsvFileUpload({ name: 'entities.txt' })).toBe(false)
  })

  it('replaces existing rows before inserting new ones', async () => {
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

    const rows = [
      {
        shortName: 'TMO',
        companyName: 'THERMA MOBILE INC.',
        birRegisteredAddress: 'Cebu',
        zipCode: '6000',
        tin: '266-566-116-00000',
        emailAddress: 'seph.grospe@gmail.com',
        regionEmailAddress: 'joseph.grospe080698@gmail.com',
      },
    ]

    await expect(replaceEntityRows(rows)).resolves.toBe(1)
    expect(deleteMock).toHaveBeenCalledWith(entities)
    expect(insertMock).toHaveBeenCalledWith(entities)
    expect(valuesMock).toHaveBeenCalledWith(rows)
  })

  it('rejects non-csv uploads before reading the file content', async () => {
    const text = vi.fn()

    await expect(
      importEntitiesCsvFile({
        name: 'entities.txt',
        text,
      }),
    ).rejects.toThrow('Only CSV files are supported.')

    expect(text).not.toHaveBeenCalled()
  })
})
