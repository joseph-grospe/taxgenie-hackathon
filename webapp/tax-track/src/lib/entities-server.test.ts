import { beforeEach, describe, expect, it, vi } from 'vitest'

import { entities } from '@/lib/schema'

import {
  importEntitiesCsvFile,
  isCsvFileUpload,
  listUploadEntities,
  parseEntitiesCsv,
  replaceEntityRows,
  toTinPrefix9,
} from '@/lib/entities-server'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}))

describe('entities-server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts the sample CSV shape and maps REGION to regionEmailAddress', () => {
    const rows =
      parseEntitiesCsv(`Short  Name ,Company Name ,BIR Registered Address,ZIP Code ,TIN,EMAIL ADDRESS,REGION
TMO ,"THERMA MOBILE, INC.",Old Veco Compound Ermita (Pob) 6000 Cebu City (Capital) Cebu Philippines,6000,266-566-116-00000,seph.grospe@gmail.com,joseph.grospe080698@gmail.com`)

    expect(rows).toEqual([
      {
        shortName: 'TMO',
        companyName: 'THERMA MOBILE, INC.',
        birRegisteredAddress:
          'Old Veco Compound Ermita (Pob) 6000 Cebu City (Capital) Cebu Philippines',
        zipCode: '6000',
        tin: '26656611600000',
        emailAddress: 'seph.grospe@gmail.com',
        regionEmailAddress: 'joseph.grospe080698@gmail.com',
      },
    ])
  })

  it('preserves quoted commas in addresses', () => {
    const rows =
      parseEntitiesCsv(`Short Name,Company Name,BIR Registered Address,ZIP Code,TIN,EMAIL ADDRESS,REGION
PEC,PAGBILAO ENERGY CORPORATION,"25/F W5TH AVENUE BUILDING 5TH AVENUE, BONIFACIO GLOBAL CITY FORT BONIFACIO, TAGUIG CITY NCR, FOURTH DISTRICT PHILIPPINES 1630",1630,008-275-398-00000,seph.grospe@gmail.com,joseph.grospe080698@gmail.com`)

    expect(rows[0]).toEqual(
      expect.objectContaining({
        birRegisteredAddress:
          '25/F W5TH AVENUE BUILDING 5TH AVENUE, BONIFACIO GLOBAL CITY FORT BONIFACIO, TAGUIG CITY NCR, FOURTH DISTRICT PHILIPPINES 1630',
      }),
    )
  })

  it('skips blank lines and converts empty cells to null', () => {
    const rows =
      parseEntitiesCsv(`Short Name,Company Name,BIR Registered Address,ZIP Code,TIN,EMAIL ADDRESS,REGION

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

  it('normalizes first 9 TIN digits for entity matching', () => {
    expect(toTinPrefix9('266-566-116-00000')).toBe('266566116')
    expect(toTinPrefix9('123-45')).toBeNull()
  })

  it('stores imported entity TINs as digits only', () => {
    const rows =
      parseEntitiesCsv(`Short Name,Company Name,BIR Registered Address,ZIP Code,TIN,EMAIL ADDRESS,REGION
TMO,THERMA MOBILE INC.,Cebu,6000,"2,6,7-0,9,0-0,7,0-0,0,0",seph.grospe@gmail.com,region@example.com`)

    expect(rows[0]?.tin).toBe('267090070000')
  })

  it('treats junk-only imported entity TINs as missing', () => {
    const rows =
      parseEntitiesCsv(`Short Name,Company Name,BIR Registered Address,ZIP Code,TIN,EMAIL ADDRESS,REGION
TMO,THERMA MOBILE INC.,Cebu,6000,TIN,seph.grospe@gmail.com,region@example.com`)

    expect(rows[0]?.tin).toBeNull()
  })

  it('does not reject short imported entity TINs during parsing', () => {
    const rows =
      parseEntitiesCsv(`Short Name,Company Name,BIR Registered Address,ZIP Code,TIN,EMAIL ADDRESS,REGION
TMO,THERMA MOBILE INC.,Cebu,6000,123-45,seph.grospe@gmail.com,region@example.com`)

    expect(rows[0]?.tin).toBe('12345')
  })

  it('lists upload entities with usable TIN prefixes', async () => {
    const orderByMock = vi.fn().mockResolvedValue([
      {
        id: 1,
        shortName: 'TMO',
        companyName: 'Therma Mobile Inc.',
        tin: '26656611600000',
      },
      {
        id: 2,
        shortName: 'BAD',
        companyName: 'Missing Tin Corp.',
        tin: '123',
      },
    ])
    const whereMock = vi.fn(() => ({
      orderBy: orderByMock,
    }))
    const fromMock = vi.fn(() => ({
      where: whereMock,
    }))
    const selectMock = vi.fn(() => ({
      from: fromMock,
    }))

    getDbMock.mockReturnValue({
      select: selectMock,
    })

    await expect(listUploadEntities()).resolves.toEqual([
      {
        id: 1,
        shortName: 'TMO',
        companyName: 'Therma Mobile Inc.',
        tin: '26656611600000',
        tinPrefix: '266566116',
      },
    ])
  })

  it('inserts new rows with normalized TINs during replacement', async () => {
    const valuesMock = vi.fn().mockResolvedValue(undefined)
    const insertMock = vi.fn(() => ({
      values: valuesMock,
    }))
    const orderByMock = vi.fn().mockResolvedValue([])
    const fromMock = vi.fn(() => ({ orderBy: orderByMock }))
    const selectMock = vi.fn(() => ({ from: fromMock }))
    const transactionMock = vi.fn((callback) =>
      callback({
        select: selectMock,
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
    expect(insertMock).toHaveBeenCalledWith(entities)
    expect(valuesMock).toHaveBeenCalledWith([
      {
        ...rows[0],
        tin: '26656611600000',
      },
    ])
  })

  it('updates a matching normalized TIN without changing its entity ID', async () => {
    const orderByMock = vi.fn().mockResolvedValue([
      {
        id: 42,
        tin: '26656611600000',
      },
    ])
    const selectMock = vi.fn(() => ({
      from: vi.fn(() => ({ orderBy: orderByMock })),
    }))
    const whereMock = vi.fn().mockResolvedValue(undefined)
    const setMock = vi.fn(() => ({ where: whereMock }))
    const updateMock = vi.fn(() => ({ set: setMock }))
    const deleteMock = vi.fn()
    const insertMock = vi.fn()
    const transactionMock = vi.fn((callback) =>
      callback({
        select: selectMock,
        update: updateMock,
        delete: deleteMock,
        insert: insertMock,
      }),
    )

    getDbMock.mockReturnValue({ transaction: transactionMock })

    const row = {
      shortName: 'TMO',
      companyName: 'THERMA MOBILE INC.',
      birRegisteredAddress: 'Cebu',
      zipCode: '6000',
      tin: '266-566-116-00000',
      emailAddress: 'admin@example.com',
      regionEmailAddress: 'region@example.com',
    }

    await expect(replaceEntityRows([row])).resolves.toBe(1)
    expect(updateMock).toHaveBeenCalledWith(entities)
    expect(setMock).toHaveBeenCalledWith({
      ...row,
      tin: '26656611600000',
    })
    expect(whereMock).toHaveBeenCalledOnce()
    expect(deleteMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('aborts replacement when an omitted entity is still referenced', async () => {
    const orderByMock = vi.fn().mockResolvedValue([
      { id: 42, tin: '26656611600000' },
      { id: 43, tin: '12345678900000' },
    ])
    const selectMock = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({ orderBy: orderByMock })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ entityId: 43 }]),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })
    const updateMock = vi.fn()
    const deleteMock = vi.fn()
    const insertMock = vi.fn()
    const transactionMock = vi.fn((callback) =>
      callback({
        select: selectMock,
        update: updateMock,
        delete: deleteMock,
        insert: insertMock,
      }),
    )

    getDbMock.mockReturnValue({ transaction: transactionMock })

    await expect(
      replaceEntityRows([
        {
          shortName: 'TMO',
          companyName: 'THERMA MOBILE INC.',
          birRegisteredAddress: 'Cebu',
          zipCode: '6000',
          tin: '26656611600000',
          emailAddress: 'admin@example.com',
          regionEmailAddress: 'region@example.com',
        },
      ]),
    ).rejects.toThrow(
      'The entity CSV omits an entity used by an upload batch or sales report.',
    )
    expect(updateMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
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
