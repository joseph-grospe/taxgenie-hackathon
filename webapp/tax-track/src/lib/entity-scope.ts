export type EntityScopeOption = {
  id: number
  label: string
  shortName: string | null
  companyName: string | null
  tin: string | null
}

export type EntityScopeFilter = Pick<
  EntityScopeOption,
  'id' | 'shortName' | 'companyName' | 'tin'
>

export const ENTITY_SCOPE_STORAGE_KEY = 'taxtrack.entityScope.v1'

const ENTITY_ID_PATTERN = /^[1-9]\d*$/

export const parseEntityScopeId = (value: unknown): string => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return ''
  }

  const entityId = String(value).trim()
  return ENTITY_ID_PATTERN.test(entityId) ? entityId : ''
}

export const normalizeEntityScopeText = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase()

export const getEntityScopeCandidates = (
  entity: Pick<EntityScopeOption, 'shortName' | 'companyName'>,
) =>
  Array.from(
    new Set(
      [entity.shortName, entity.companyName]
        .map((value) => normalizeEntityScopeText(value))
        .filter(Boolean),
    ),
  )

export const buildEntityScopeLabel = (
  entity: Pick<EntityScopeOption, 'id' | 'shortName' | 'companyName' | 'tin'>,
) => {
  const shortName = entity.shortName?.trim() ?? ''
  const companyName = entity.companyName?.trim() ?? ''
  const tin = entity.tin?.trim() ?? ''

  if (shortName && companyName) {
    return normalizeEntityScopeText(shortName) ===
      normalizeEntityScopeText(companyName)
      ? shortName
      : `${shortName} - ${companyName}`
  }

  return shortName || companyName || tin || `Entity ${entity.id}`
}
