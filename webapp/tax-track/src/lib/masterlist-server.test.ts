import { beforeEach, describe, expect, it, vi } from 'vitest'

import { masterlist } from '@/lib/schema'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}))

import {
  importMasterlistCsvFile,
  isCsvFileUpload,
  parseMasterlistCsv,
  replaceMasterlistRows,
} from '@/lib/masterlist-server'

describe('masterlist-server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a valid CSV and maps all supported headers', () => {
    const rows =
      parseMasterlistCsv(`REGION, ENTITY ,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,123-456-789-000,Manila,a@example.com`)

    expect(rows).toEqual([
      {
        region: 'NCR',
        entity: 'Entity A',
        shortName: 'EA',
        customerName: 'Customer A',
        tin: '123456789000',
        address: 'Manila',
        emailAddress: 'a@example.com',
      },
    ])
  })

  it('skips blank lines and converts empty cells to null', () => {
    const rows =
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address

Region 1,Entity A,,Customer A,,,
`)

    expect(rows).toEqual([
      {
        region: 'Region 1',
        entity: 'Entity A',
        shortName: null,
        customerName: 'Customer A',
        tin: null,
        address: null,
        emailAddress: null,
      },
    ])
  })

  it('stores imported masterlist TINs as digits only', () => {
    const rows =
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,267x090x070x0000,Manila,a@example.com`)

    expect(rows[0]?.tin).toBe('2670900700000')
  })

  it('treats junk-only imported masterlist TINs as missing', () => {
    const rows =
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,---,Manila,a@example.com`)

    expect(rows[0]?.tin).toBeNull()
  })

  it('does not reject short imported masterlist TINs during parsing', () => {
    const rows =
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,123-45,Manila,a@example.com`)

    expect(rows[0]?.tin).toBe('12345')
  })

  it('rejects missing required headers', () => {
    expect(() =>
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address
NCR,Entity A,EA,Customer A,123,Manila`),
    ).toThrow('CSV is missing required headers: Email Address.')
  })

  it('rejects empty file content', () => {
    expect(() => parseMasterlistCsv(' \n')).toThrow('CSV file is empty.')
  })

  it('accepts only csv file names for uploads', () => {
    expect(isCsvFileUpload({ name: 'masterlist.csv' })).toBe(true)
    expect(isCsvFileUpload({ name: 'masterlist.txt' })).toBe(false)
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
        region: 'NCR',
        entity: 'Entity A',
        shortName: 'EA',
        customerName: 'Customer A',
        tin: '123-456-789-000',
        address: 'Manila',
        emailAddress: 'a@example.com',
      },
    ]

    await expect(replaceMasterlistRows(rows)).resolves.toBe(1)
    expect(deleteMock).toHaveBeenCalledWith(masterlist)
    expect(insertMock).toHaveBeenCalledWith(masterlist)
    expect(valuesMock).toHaveBeenCalledWith([
      {
        ...rows[0],
        tin: '123456789000',
      },
    ])
  })

  it('rejects non-csv uploads before reading the file content', async () => {
    const text = vi.fn()

    await expect(
      importMasterlistCsvFile({
        name: 'masterlist.txt',
        text,
      }),
    ).rejects.toThrow('Only CSV files are supported.')

    expect(text).not.toHaveBeenCalled()
  })
})
