import { useCallback, useRef, useState } from 'react'

// A per-scope back/forward stack. Every scope (one browse tab, one editor
// tab, one size or backup tab, one global view, the play overlay) keeps its
// own independent position, so walking back in one never drags in another's
// trail. Scopes live in a ref (not React state) so push/back/forward stay
// cheap and synchronous; a small counter forces a re-render whenever a scope
// changes so components reading canGoBack/canGoForward during render see the
// new position.
export function useNavHistory() {
  const scopes = useRef(new Map()) // scopeKey -> { stack: entry[], idx: number }
  const [, bumpVersion] = useState(0)

  function scopeFor(scopeKey) {
    let scope = scopes.current.get(scopeKey)
    if (!scope) {
      scope = { stack: [], idx: -1 }
      scopes.current.set(scopeKey, scope)
    }
    return scope
  }

  const push = useCallback((scopeKey, entry) => {
    const scope = scopeFor(scopeKey)
    scope.stack = scope.stack.slice(0, scope.idx + 1)
    scope.stack.push(entry)
    scope.idx = scope.stack.length - 1
    bumpVersion((v) => v + 1)
  }, [])

  const back = useCallback((scopeKey) => {
    const scope = scopes.current.get(scopeKey)
    if (!scope || scope.idx <= 0) return null
    scope.idx--
    bumpVersion((v) => v + 1)
    return scope.stack[scope.idx]
  }, [])

  const forward = useCallback((scopeKey) => {
    const scope = scopes.current.get(scopeKey)
    if (!scope || scope.idx >= scope.stack.length - 1) return null
    scope.idx++
    bumpVersion((v) => v + 1)
    return scope.stack[scope.idx]
  }, [])

  const canGoBack = useCallback((scopeKey) => {
    const scope = scopes.current.get(scopeKey)
    return Boolean(scope) && scope.idx > 0
  }, [])

  const canGoForward = useCallback((scopeKey) => {
    const scope = scopes.current.get(scopeKey)
    return Boolean(scope) && scope.idx < scope.stack.length - 1
  }, [])

  return { push, back, forward, canGoBack, canGoForward }
}
