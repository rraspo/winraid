import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEntryView } from './useEntryView'

const ENTRIES = [
  { name: 'banana.txt', type: 'file', size: 10, modified: 300 },
  { name: 'docs',       type: 'dir',  size: 0,  modified: 100 },
  { name: 'apple.txt',  type: 'file', size: 20, modified: 200 },
  { name: 'photos',     type: 'dir',  size: 0,  modified: 400 },
]

const SORT_PREFS_KEY = 'browse-sort-prefs'

let dirsFirstRef
let sortPersistRef

// The two refs are per-test singletons because useBrowse passes useRef objects
// whose identity is stable across renders — a fresh object per render would
// churn every callback that closes over them.
function makeArgs(overrides = {}) {
  return {
    entries: ENTRIES,
    path:    '/media',
    dirsFirstRef,
    sortPersistRef,
    ...overrides,
  }
}

function names(list) {
  return list.map((entry) => entry.name)
}

beforeEach(() => {
  localStorage.clear()
  dirsFirstRef   = { current: true }
  sortPersistRef = { current: 'default' }
})

describe('useEntryView — ordering', () => {
  it('groups directories ahead of files when the settings ref says dirs-first', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    expect(names(result.current.filteredEntries)).toEqual([
      'docs', 'photos', 'apple.txt', 'banana.txt',
    ])
  })

  it('interleaves directories with files when the settings ref turns dirs-first off', () => {
    dirsFirstRef.current = false
    const { result } = renderHook(() => useEntryView(makeArgs()))
    expect(names(result.current.filteredEntries)).toEqual([
      'apple.txt', 'banana.txt', 'docs', 'photos',
    ])
  })

  it('defaults to nameAsc', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    expect(result.current.sortMode).toBe('nameAsc')
  })

  it('orders by name descending in nameDesc', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    act(() => result.current.setSortMode('nameDesc'))
    expect(names(result.current.filteredEntries)).toEqual([
      'photos', 'docs', 'banana.txt', 'apple.txt',
    ])
  })

  it('orders newest first in recent', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    act(() => result.current.setSortMode('recent'))
    expect(names(result.current.filteredEntries)).toEqual([
      'photos', 'docs', 'banana.txt', 'apple.txt',
    ])
  })

  it('orders oldest first in oldest', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    act(() => result.current.setSortMode('oldest'))
    expect(names(result.current.filteredEntries)).toEqual([
      'docs', 'photos', 'apple.txt', 'banana.txt',
    ])
  })
})

describe('useEntryView — sort persistence', () => {
  it('writes nothing when the persistence mode is default', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    act(() => result.current.setSortMode('recent'))
    expect(result.current.sortMode).toBe('recent')
    expect(localStorage.getItem(SORT_PREFS_KEY)).toBeNull()
  })

  it('stores the mode under the current folder when the persistence mode is folder', () => {
    sortPersistRef.current = 'folder'
    const { result } = renderHook(() => useEntryView(makeArgs()))
    act(() => result.current.setSortMode('oldest'))
    expect(JSON.parse(localStorage.getItem(SORT_PREFS_KEY))).toEqual({ '/media': 'oldest' })
  })

  it('stores the mode under the parent folder when the persistence mode is siblings', () => {
    sortPersistRef.current = 'siblings'
    const { result } = renderHook(() => useEntryView(makeArgs({ path: '/media/movies' })))
    act(() => result.current.setSortMode('nameDesc'))
    expect(JSON.parse(localStorage.getItem(SORT_PREFS_KEY))).toEqual({ 'siblings:/media': 'nameDesc' })
  })

  it('resolves the stored mode for the destination folder on navigation', () => {
    sortPersistRef.current = 'folder'
    localStorage.setItem(SORT_PREFS_KEY, JSON.stringify({ '/media/movies': 'recent' }))
    const { result, rerender } = renderHook((args) => useEntryView(args), {
      initialProps: makeArgs(),
    })
    expect(result.current.sortMode).toBe('nameAsc')
    rerender(makeArgs({ path: '/media/movies' }))
    expect(result.current.sortMode).toBe('recent')
  })
})

describe('useEntryView — search', () => {
  it('filters entries by a case-insensitive name substring', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    act(() => result.current.setSearchQuery('AP'))
    expect(names(result.current.filteredEntries)).toEqual(['apple.txt'])
  })

  it('applies the sort order to the filtered list', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    act(() => result.current.setSortMode('nameDesc'))
    act(() => result.current.setSearchQuery('a'))
    expect(names(result.current.filteredEntries)).toEqual([
      'banana.txt', 'apple.txt',
    ])
  })

  it('ignores surrounding whitespace and treats an empty query as no filter', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    act(() => result.current.setSearchQuery('   '))
    expect(result.current.filteredEntries).toHaveLength(4)
  })

  // Current behaviour: the filter lowercases but does not fold diacritics, so an
  // unaccented query misses an accented name. Pinned as-is to keep this hook's
  // extraction behaviour-preserving.
  it('matches an accented name only when the query carries the same diacritics', () => {
    const accented = [{ name: 'Andrés.txt', type: 'file', size: 1, modified: 0 }]
    const { result } = renderHook(() => useEntryView(makeArgs({ entries: accented })))
    act(() => result.current.setSearchQuery('andré'))
    expect(names(result.current.filteredEntries)).toEqual(['Andrés.txt'])
    act(() => result.current.setSearchQuery('andres'))
    expect(result.current.filteredEntries).toEqual([])
  })

  it('clears the query when the path changes', () => {
    const { result, rerender } = renderHook((args) => useEntryView(args), {
      initialProps: makeArgs(),
    })
    act(() => result.current.setSearchQuery('ap'))
    expect(result.current.searchQuery).toBe('ap')
    rerender(makeArgs({ path: '/media/movies' }))
    expect(result.current.searchQuery).toBe('')
    expect(result.current.filteredEntries).toHaveLength(4)
  })

  it('keeps the query when the hook re-renders on the same path', () => {
    const { result, rerender } = renderHook((args) => useEntryView(args), {
      initialProps: makeArgs(),
    })
    act(() => result.current.setSearchQuery('ap'))
    rerender(makeArgs())
    expect(result.current.searchQuery).toBe('ap')
  })
})

describe('useEntryView — derived lists', () => {
  it('drops directories and stamps an absolute path on fileEntries', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    expect(result.current.fileEntries).toEqual([
      { name: 'apple.txt',  type: 'file', size: 20, modified: 200, path: '/media/apple.txt' },
      { name: 'banana.txt', type: 'file', size: 10, modified: 300, path: '/media/banana.txt' },
    ])
  })

  it('stamps entryPath on every entry in entriesWithPaths', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    expect(result.current.entriesWithPaths.map((entry) => entry.entryPath)).toEqual([
      '/media/docs', '/media/photos', '/media/apple.txt', '/media/banana.txt',
    ])
  })

  it('joins against the root without doubling the separator', () => {
    const { result } = renderHook(() => useEntryView(makeArgs({ path: '/' })))
    expect(result.current.entriesWithPaths.map((entry) => entry.entryPath)).toEqual([
      '/docs', '/photos', '/apple.txt', '/banana.txt',
    ])
  })

  it('counts directories and files over the filtered list', () => {
    const { result } = renderHook(() => useEntryView(makeArgs()))
    expect(result.current.dirCount).toBe(2)
    expect(result.current.fileCount).toBe(2)

    act(() => result.current.setSearchQuery('o'))
    expect(result.current.dirCount).toBe(2)
    expect(result.current.fileCount).toBe(0)
  })
})
