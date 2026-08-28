import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  importMasterlistCsvFile,
  isCsvFileUpload,
  parseMasterlistCsv,
  replaceMasterlistRows,
} from '@/lib/masterlist-server'
import { masterlist } from '@/lib/schema'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}))

describe('masterlist-server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a valid CSV and maps all supported headers', () => {
    const rows =
      parseMasterlistCsv(`REGION, ENTITY ,Short Name,CUSTOMER NAME,TIN,Address,Email Address,Government
NCR,Entity A,EA,Customer A,123-456-789-000,Manila,a@example.com,Y`)

    expect(rows).toEqual([
      {
        region: 'NCR',
        entity: 'Entity A',
        shortName: 'EA',
        customerName: 'Customer A',
        tin: '123456789000',
        address: 'Manila',
        emailAddress: 'a@example.com',
        isGovernment: true,
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
        isGovernment: false,
      },
    ])
  })

  it('maps government N and blank values to false', () => {
    const rows =
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address,Government
NCR,Entity A,EA,Customer A,123456789,Manila,a@example.com,N
NCR,Entity B,EB,Customer B,456789123,Quezon,b@example.com,`)

    expect(rows.map((row) => row.isGovernment)).toEqual([false, false])
  })

  it('stores imported masterlist TINs as digits only', () => {
    const rows =
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,267x090x070x0000,Manila,a@example.com`)

    expect(rows[0]?.tin).toBe('2670900700000')
  })

  it('rejects junk-only imported masterlist TINs with row context', () => {
    expect(() =>
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,---,Manila,a@example.com`),
    ).toThrow('CSV row 2, TIN: TIN must contain at least 9 digits.')
  })

  it('rejects short imported masterlist TINs during parsing', () => {
    expect(() =>
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,123-45,Manila,a@example.com`),
    ).toThrow('CSV row 2, TIN: TIN must contain at least 9 digits.')
  })

  it('rejects malformed email addresses with row and column context', () => {
    expect(() =>
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,123456789,Manila,not-an-email`),
    ).toThrow('CSV row 2, Email Address: Enter a valid email address.')
  })

  it('accepts semicolon-separated email addresses', () => {
    const rows =
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,123456789,Manila,a@example.com; b@example.com`)

    expect(rows[0]?.emailAddress).toBe('a@example.com; b@example.com')
  })

  it('rejects an email list containing a malformed address', () => {
    expect(() =>
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,123456789,Manila,a@example.com; not-an-email`),
    ).toThrow('CSV row 2, Email Address: Enter a valid email address.')
  })

  it('rejects rows without a customer name, short name, or TIN', () => {
    expect(() =>
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,,,,Manila,`),
    ).toThrow(
      'CSV row 2, CUSTOMER NAME: Enter a customer name, short name, or TIN.',
    )
  })

  it('rejects missing required headers', () => {
    expect(() =>
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address
NCR,Entity A,EA,Customer A,123,Manila`),
    ).toThrow('CSV is missing required headers: Email Address.')
  })

  it('does not require the government header', () => {
    const rows =
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address
NCR,Entity A,EA,Customer A,123456789,Manila,a@example.com`)

    expect(rows[0]?.isGovernment).toBe(false)
  })

  it('rejects invalid government values', () => {
    expect(() =>
      parseMasterlistCsv(`REGION,ENTITY,Short Name,CUSTOMER NAME,TIN,Address,Email Address,Government
NCR,Entity A,EA,Customer A,123,Manila,a@example.com,Yes`),
    ).toThrow('CSV contains invalid Government value on row 2. Use Y or N.')
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
    const transactionMock = vi.fn((callback) =>
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
        isGovernment: true,
      },
    ]

    await expect(replaceMasterlistRows(rows)).resolves.toBe(1)
    expect(deleteMock).toHaveBeenCalledWith(masterlist)
    expect(insertMock).toHaveBeenCalledWith(masterlist)
    expect(valuesMock).toHaveBeenCalledWith([
      {
        ...rows[0],
        tin: '123456789000',
        isGovernment: true,
      },
    ])
  })

  it('defaults missing government values before inserting rows', async () => {
    const deleteMock = vi.fn().mockResolvedValue(undefined)
    const valuesMock = vi.fn().mockResolvedValue(undefined)
    const insertMock = vi.fn(() => ({
      values: valuesMock,
    }))
    const transactionMock = vi.fn((callback) =>
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
    expect(valuesMock).toHaveBeenCalledWith([
      {
        ...rows[0],
        tin: '123456789000',
        isGovernment: false,
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
