export type ValidatedCustomerType =
  | 'IEMOP'
  | 'Regular'
  | 'Non-Trade'
  | 'Unknown'

export type ValidatedDerivedDimensions = {
  entity: string
  customerType: ValidatedCustomerType
  errorTypes?: Array<string>
}

export const validatedDerivedDimensionsByDocId: Partial<
  Record<string, ValidatedDerivedDimensions>
> = {
  'VAL-3301': {
    entity: 'AESI',
    customerType: 'Regular',
  },
  'VAL-3302': {
    entity: 'IEMOP',
    customerType: 'IEMOP',
  },
  'VAL-3303': {
    entity: 'AESI',
    customerType: 'Non-Trade',
  },
}

export const validatedDerivedDimensionsByFileName: Partial<
  Record<string, ValidatedDerivedDimensions>
> = {
  'AESI_201115150_12312025_004.pdf': {
    entity: 'AESI',
    customerType: 'Regular',
  },
  'AESI_201115150_12312025_006.pdf': {
    entity: 'IEMOP',
    customerType: 'IEMOP',
  },
  'AESI_201115150_12312025_008.pdf': {
    entity: 'AESI',
    customerType: 'Non-Trade',
  },
}
