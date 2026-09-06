import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNavHistory } from './useNavHistory'

// Contract under test — history is per scope, not per app. A scope is one
// browse tab, one editor tab, one size or backup tab, or a global view.
// Walking back in one view never drags you into another view's history.
//
//   push(scopeKey, entry)   remembers an entry in that scope
//   back(scopeKey)          returns the previous entry in that scope, or
//                           null at the start of it
//   forward(scopeKey)       returns the next entry in that scope, or null
//                           at the end of it
//   canGoBack / canGoForward report the same, without moving

function entry(path) {
  return { kind: 'browse', path, connectionId: 'c1', quickLookFile: null }
}

describe('useNavHistory', () => {
  it('walks back and forward within one scope', () => {
    const { result } = renderHook(() => useNavHistory())
    act(() => {
      result.current.push('browse:t1', entry('/a'))
      result.current.push('browse:t1', entry('/a/b'))
      result.current.push('browse:t1', entry('/a/b/c'))
    })
    let seen
    act(() => { seen = result.current.back('browse:t1') })
    expect(seen.path).toBe('/a/b')
    act(() => { seen = result.current.back('browse:t1') })
    expect(seen.path).toBe('/a')
    act(() => { seen = result.current.forward('browse:t1') })
    expect(seen.path).toBe('/a/b')
  })

  it('stops at the start and the end of a scope', () => {
    const { result } = renderHook(() => useNavHistory())
    act(() => { result.current.push('browse:t1', entry('/a')) })
    let seen
    act(() => { seen = result.current.back('browse:t1') })
    expect(seen).toBeNull()
    act(() => { seen = result.current.forward('browse:t1') })
    expect(seen).toBeNull()
  })

  it('keeps every scope independent', () => {
    const { result } = renderHook(() => useNavHistory())
    act(() => {
      result.current.push('browse:t1', entry('/a'))
      result.current.push('browse:t1', entry('/a/b'))
      result.current.push('browse:t2', entry('/x'))
      result.current.push('browse:t2', entry('/x/y'))
    })
    let seen
    act(() => { seen = result.current.back('browse:t2') })
    expect(seen.path).toBe('/x')
    act(() => { seen = result.current.back('browse:t1') })
    expect(seen.path).toBe('/a')
    // Each scope kept its own position: t2 can still go forward on its own.
    act(() => { seen = result.current.forward('browse:t2') })
    expect(seen.path).toBe('/x/y')
  })

  it('returns nothing for a scope that has no history', () => {
    const { result } = renderHook(() => useNavHistory())
    let seen
    act(() => { seen = result.current.back('settings') })
    expect(seen).toBeNull()
    act(() => { seen = result.current.forward('settings') })
    expect(seen).toBeNull()
  })

  it('drops the forward trail when a new entry is pushed after going back', () => {
    const { result } = renderHook(() => useNavHistory())
    act(() => {
      result.current.push('browse:t1', entry('/a'))
      result.current.push('browse:t1', entry('/a/b'))
      result.current.back('browse:t1')
      result.current.push('browse:t1', entry('/a/z'))
    })
    let seen
    act(() => { seen = result.current.forward('browse:t1') })
    expect(seen).toBeNull()
    act(() => { seen = result.current.back('browse:t1') })
    expect(seen.path).toBe('/a')
  })

  it('reports whether a scope can move without moving it', () => {
    const { result } = renderHook(() => useNavHistory())
    act(() => {
      result.current.push('browse:t1', entry('/a'))
      result.current.push('browse:t1', entry('/a/b'))
    })
    expect(result.current.canGoBack('browse:t1')).toBe(true)
    expect(result.current.canGoForward('browse:t1')).toBe(false)
    expect(result.current.canGoBack('browse:t2')).toBe(false)
    let seen
    act(() => { seen = result.current.back('browse:t1') })
    expect(seen.path).toBe('/a')
    expect(result.current.canGoForward('browse:t1')).toBe(true)
  })
})
