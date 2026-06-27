import * as React from 'react'

export const ROUTE_SEARCH_DEBOUNCE_MS = 300

type ScrollSnapshot = {
  windowX: number
  windowY: number
  focusedElement: Element | null
  scrollableAncestors: Array<{
    element: Element
    left: number
    top: number
  }>
}

const captureScrollSnapshot = (): ScrollSnapshot | null => {
  if (typeof window === 'undefined') return null

  const focusedElement =
    document.activeElement instanceof Element ? document.activeElement : null
  const scrollableAncestors: ScrollSnapshot['scrollableAncestors'] = []

  let element = focusedElement?.parentElement ?? null
  while (element) {
    if (
      element.scrollHeight > element.clientHeight ||
      element.scrollWidth > element.clientWidth
    ) {
      scrollableAncestors.push({
        element,
        left: element.scrollLeft,
        top: element.scrollTop,
      })
    }
    element = element.parentElement
  }

  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    focusedElement,
    scrollableAncestors,
  }
}

const restoreScrollSnapshot = (snapshot: ScrollSnapshot | null) => {
  if (!snapshot || typeof window === 'undefined') return

  for (const entry of snapshot.scrollableAncestors) {
    entry.element.scrollLeft = entry.left
    entry.element.scrollTop = entry.top
  }

  window.scrollTo({
    left: snapshot.windowX,
    top: snapshot.windowY,
  })

  if (
    snapshot.focusedElement &&
    document.contains(snapshot.focusedElement) &&
    document.activeElement === snapshot.focusedElement &&
    'scrollIntoView' in snapshot.focusedElement
  ) {
    snapshot.focusedElement.scrollIntoView({ block: 'nearest' })
  }
}

const scheduleScrollSnapshotRestore = (snapshot: ScrollSnapshot | null) => {
  if (!snapshot || typeof window === 'undefined') return

  restoreScrollSnapshot(snapshot)
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => restoreScrollSnapshot(snapshot))
  }
  window.setTimeout(() => restoreScrollSnapshot(snapshot), 50)
  window.setTimeout(() => restoreScrollSnapshot(snapshot), 200)
}

export const preserveScrollDuringNavigation = <T>(runNavigation: () => T): T => {
  const scrollSnapshot = captureScrollSnapshot()

  try {
    const navigation = runNavigation()
    scheduleScrollSnapshotRestore(scrollSnapshot)
    void Promise.resolve(navigation)
      .finally(() => {
        scheduleScrollSnapshotRestore(scrollSnapshot)
      })
      .catch(() => undefined)
    return navigation
  } catch (error) {
    scheduleScrollSnapshotRestore(scrollSnapshot)
    throw error
  }
}

type UseDebouncedRouteSearchInputOptions = {
  value: string
  onCommit: (value: string) => void
  debounceMs?: number
}

type UseDebouncedRouteSearchInputResult = {
  inputValue: string
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  commitInputValue: (
    nextValue: string,
    commitOverride?: (value: string) => void,
  ) => void
}

export const useDebouncedRouteSearchInput = ({
  value,
  onCommit,
  debounceMs = ROUTE_SEARCH_DEBOUNCE_MS,
}: UseDebouncedRouteSearchInputOptions): UseDebouncedRouteSearchInputResult => {
  const [inputValue, setInputValueState] = React.useState(value)
  const onCommitRef = React.useRef(onCommit)
  const immediateCommitValueRef = React.useRef<string | null>(null)
  const localInputDirtyRef = React.useRef(false)
  const lastCommittedValueRef = React.useRef(value)

  React.useEffect(() => {
    onCommitRef.current = onCommit
  }, [onCommit])

  React.useEffect(() => {
    setInputValueState((currentValue) => {
      if (
        localInputDirtyRef.current &&
        value === lastCommittedValueRef.current &&
        currentValue !== value
      ) {
        return currentValue
      }

      localInputDirtyRef.current = false
      lastCommittedValueRef.current = value
      return value
    })
  }, [value])

  React.useEffect(() => {
    if (inputValue === value) {
      immediateCommitValueRef.current = null
      localInputDirtyRef.current = false
      return
    }

    if (immediateCommitValueRef.current === inputValue) return

    const timeoutId = window.setTimeout(() => {
      lastCommittedValueRef.current = inputValue
      onCommitRef.current(inputValue)
    }, debounceMs)

    return () => window.clearTimeout(timeoutId)
  }, [debounceMs, inputValue, value])

  const setInputValue = React.useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >((nextValue) => {
    localInputDirtyRef.current = true
    setInputValueState(nextValue)
  }, [])

  const commitInputValue = React.useCallback(
    (nextValue: string, commitOverride?: (value: string) => void) => {
      setInputValueState(nextValue)
      localInputDirtyRef.current = true
      lastCommittedValueRef.current = nextValue

      if (commitOverride) {
        immediateCommitValueRef.current = nextValue
        commitOverride(nextValue)
        return
      }

      if (nextValue === value) return

      immediateCommitValueRef.current = nextValue
      onCommitRef.current(nextValue)
    },
    [value],
  )

  return {
    inputValue,
    setInputValue,
    commitInputValue,
  }
}
