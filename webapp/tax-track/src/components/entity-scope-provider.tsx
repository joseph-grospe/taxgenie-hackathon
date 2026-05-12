import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'

import type { EntityScopeOption } from '@/lib/entity-scope'
import {
  ENTITY_SCOPE_STORAGE_KEY,
  parseEntityScopeId,
} from '@/lib/entity-scope'

type EntityScopeResponse = {
  entities?: Array<EntityScopeOption>
  error?: string
}

type EntityScopeContextValue = {
  entities: Array<EntityScopeOption>
  entityById: Map<string, EntityScopeOption>
  selectedEntityId: string
  selectedEntity: EntityScopeOption | null
  isLoading: boolean
  hasLoaded: boolean
  error: string | null
  ensureEntitiesLoaded: () => void
  setSelectedEntityId: (entityId: string) => void
}

const EntityScopeContext = createContext<EntityScopeContextValue | null>(null)

const readStoredEntityId = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return parseEntityScopeId(
      window.localStorage.getItem(ENTITY_SCOPE_STORAGE_KEY),
    )
  } catch {
    return ''
  }
}

const writeStoredEntityId = (entityId: string) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (entityId) {
      window.localStorage.setItem(ENTITY_SCOPE_STORAGE_KEY, entityId)
      return
    }

    window.localStorage.removeItem(ENTITY_SCOPE_STORAGE_KEY)
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

export function EntityScopeProvider({ children }: { children: ReactNode }) {
  const [entities, setEntities] = useState<Array<EntityScopeOption>>([])
  const [selectedEntityId, setSelectedEntityIdState] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedEntityIdState(readStoredEntityId())
  }, [])

  const entityById = useMemo(
    () => new Map(entities.map((entity) => [String(entity.id), entity])),
    [entities],
  )
  const selectedEntity = selectedEntityId
    ? (entityById.get(selectedEntityId) ?? null)
    : null

  const setSelectedEntityId = useCallback((entityId: string) => {
    const normalizedEntityId = parseEntityScopeId(entityId)
    setSelectedEntityIdState(normalizedEntityId)
    writeStoredEntityId(normalizedEntityId)
  }, [])

  const ensureEntitiesLoaded = useCallback(() => {
    if (hasLoaded || isLoading) {
      return
    }

    setIsLoading(true)
    void (async () => {
      try {
        const response = await fetch('/api/entities', {
          cache: 'no-store',
        })
        const payload = (await response
          .json()
          .catch(() => null)) as EntityScopeResponse | null

        if (!response.ok) {
          throw new Error(
            payload?.error || `Failed to load entities (${response.status}).`,
          )
        }

        setEntities(Array.isArray(payload?.entities) ? payload.entities : [])
        setHasLoaded(true)
        setError(null)
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load entities.',
        )
      } finally {
        setIsLoading(false)
      }
    })()
  }, [hasLoaded, isLoading])

  useEffect(() => {
    if (!hasLoaded || !selectedEntityId || entityById.has(selectedEntityId)) {
      return
    }

    setSelectedEntityId('')
  }, [entityById, hasLoaded, selectedEntityId, setSelectedEntityId])

  const value = useMemo<EntityScopeContextValue>(
    () => ({
      entities,
      entityById,
      selectedEntity,
      selectedEntityId,
      isLoading,
      hasLoaded,
      error,
      ensureEntitiesLoaded,
      setSelectedEntityId,
    }),
    [
      entities,
      entityById,
      selectedEntity,
      selectedEntityId,
      isLoading,
      hasLoaded,
      error,
      ensureEntitiesLoaded,
      setSelectedEntityId,
    ],
  )

  return (
    <EntityScopeContext.Provider value={value}>
      {children}
    </EntityScopeContext.Provider>
  )
}

export const useEntityScope = () => {
  const context = useContext(EntityScopeContext)
  if (!context) {
    throw new Error('useEntityScope must be used within EntityScopeProvider.')
  }

  return context
}
