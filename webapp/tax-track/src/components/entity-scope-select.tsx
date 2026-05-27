import { useLocation, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo } from 'react'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { parseEntityScopeId } from '@/lib/entity-scope'
import { useEntityScope } from '@/components/entity-scope-provider'

const ENTITY_SCOPE_PATHS = new Set([
  '/dashboard',
  '/batches',
  '/issues',
  '/validated',
  '/upload',
  '/reconciliation',
])

const PAGINATED_ENTITY_SCOPE_PATHS = new Set([
  '/batches',
  '/issues',
  '/validated',
  '/reconciliation',
])

const hasSearchValue = (value: unknown) =>
  (typeof value === 'string' || typeof value === 'number') &&
  String(value).trim().length > 0

export const isEntityScopePath = (pathname: string) =>
  ENTITY_SCOPE_PATHS.has(pathname) || pathname.startsWith('/reconciliation/')

export function EntityScopeSelect() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    entities,
    entityById,
    selectedEntityId,
    isLoading,
    hasLoaded,
    ensureEntitiesLoaded,
    setSelectedEntityId,
  } = useEntityScope()
  const search = location.search as Record<string, unknown>
  const isScopedPath = isEntityScopePath(location.pathname)
  const rawRouteEntityId = search.entityId
  const routeEntityId = parseEntityScopeId(rawRouteEntityId)
  const currentEntityId =
    routeEntityId ||
    (selectedEntityId && entityById.has(selectedEntityId)
      ? selectedEntityId
      : '')
  const currentEntityLabel = currentEntityId
    ? (entityById.get(currentEntityId)?.label ?? `Entity ${currentEntityId}`)
    : 'All entities'
  const invalidRouteEntityId =
    hasSearchValue(rawRouteEntityId) && routeEntityId.length === 0

  const replaceRouteEntityId = useCallback(
    (entityId: string) => {
      const nextEntityId = parseEntityScopeId(entityId)

      void navigate({
        search: (previous: unknown) => {
          const previousSearch = previous as Record<string, unknown>
          const nextSearch: Record<string, unknown> = {
            ...previousSearch,
            entity: undefined,
            entityId: nextEntityId || undefined,
          }

          if (PAGINATED_ENTITY_SCOPE_PATHS.has(location.pathname)) {
            nextSearch.page = 1
          }

          return nextSearch
        },
        replace: true,
      } as never)
    },
    [location.pathname, navigate],
  )

  useEffect(() => {
    if (isScopedPath) {
      ensureEntitiesLoaded()
    }
  }, [ensureEntitiesLoaded, isScopedPath])

  useEffect(() => {
    if (!isScopedPath || !hasLoaded) {
      return
    }

    if (invalidRouteEntityId) {
      setSelectedEntityId('')
      replaceRouteEntityId('')
      return
    }

    if (routeEntityId) {
      if (entityById.has(routeEntityId)) {
        if (selectedEntityId !== routeEntityId) {
          setSelectedEntityId(routeEntityId)
        }
        return
      }

      setSelectedEntityId('')
      replaceRouteEntityId('')
      return
    }

    if (selectedEntityId && entityById.has(selectedEntityId)) {
      replaceRouteEntityId(selectedEntityId)
    }
  }, [
    entityById,
    hasLoaded,
    invalidRouteEntityId,
    isScopedPath,
    replaceRouteEntityId,
    routeEntityId,
    selectedEntityId,
    setSelectedEntityId,
  ])

  const selectValueRenderer = useMemo(
    () => () => currentEntityLabel,
    [currentEntityLabel],
  )

  if (!isScopedPath) {
    return null
  }

  return (
    <Select
      value={currentEntityId || 'all'}
      onValueChange={(value: string | null) => {
        const nextEntityId = value && value !== 'all' ? value : ''
        setSelectedEntityId(nextEntityId)
        replaceRouteEntityId(nextEntityId)
      }}
      disabled={isLoading && entities.length === 0}
    >
      <SelectTrigger
        aria-label="Entity scope"
        size="sm"
        className="w-40 sm:w-56"
      >
        <SelectValue
          placeholder={isLoading ? 'Loading entities' : 'All entities'}
        >
          {selectValueRenderer}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          <SelectItem value="all">All entities</SelectItem>
          {entities.map((entity) => (
            <SelectItem key={entity.id} value={String(entity.id)}>
              {entity.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
