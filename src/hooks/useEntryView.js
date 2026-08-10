import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { sortEntries } from '../utils/sortEntries'
import { resolveSortMode, saveSortMode } from '../utils/sortPersistence'
import { normalizeForSearch } from '../utils/normalizeForSearch'

function joinRemote(base, name) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

// View-shaping concern for the remote browser: the sort mode with its
// per-folder persistence, the live name filter, and the derived lists every
// view renders from. Takes the raw listing and returns what the user sees.
//
// dirsFirstRef and sortPersistRef are the composing hook's settings refs — the
// browse settings are loaded once there, so this module never opens a second
// config read.
export function useEntryView({ entries, path, dirsFirstRef, sortPersistRef }) {
  // Live name-substring filter scoped to the current directory's loaded
  // entries (no IPC — entries are already in memory). Cleared on
  // navigation so it doesn't carry into the next folder.
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode,    setSortModeRaw] = useState('nameAsc')

  const prevPath = useRef(path)

  useEffect(() => {
    if (prevPath.current !== path) {
      setSearchQuery('')
      setSortModeRaw(resolveSortMode(path, sortPersistRef.current))
    }
    prevPath.current = path
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply the search filter as a single source for downstream derivations,
  // including selection bookkeeping — the views pass row indexes into the
  // filtered list, so useSelection must resolve them against the same list.
  // The `selected` Set is keyed by name, so prior selections survive a
  // filter change naturally (names not in the visible list stay selected
  // but invisible).
  const filteredEntries = useMemo(() => {
    const q = normalizeForSearch(searchQuery.trim())
    const filtered = q ? entries.filter((e) => normalizeForSearch(e.name).includes(q)) : entries
    return sortEntries(filtered, sortMode, dirsFirstRef.current)
  }, [entries, searchQuery, sortMode]) // eslint-disable-line react-hooks/exhaustive-deps -- dirsFirstRef is a ref

  const setSortMode = useCallback((mode) => {
    setSortModeRaw(mode)
    saveSortMode(path, mode, sortPersistRef.current)
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps -- sortPersistRef is a ref

  const fileEntries = useMemo(
    () => filteredEntries
      .filter((e) => e.type !== 'dir')
      .map((e) => ({ ...e, path: joinRemote(path, e.name) })),
    [filteredEntries, path],
  )

  const entriesWithPaths = useMemo(
    () => filteredEntries.map((e) => ({ ...e, entryPath: joinRemote(path, e.name) })),
    [filteredEntries, path],
  )

  const dirCount  = useMemo(() => filteredEntries.filter((e) => e.type === 'dir').length, [filteredEntries])
  const fileCount = filteredEntries.length - dirCount

  return {
    sortMode, setSortMode,
    searchQuery, setSearchQuery,
    filteredEntries, fileEntries, entriesWithPaths,
    dirCount, fileCount,
  }
}
