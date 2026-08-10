import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSelection } from './useSelection'
import { useDragDrop } from './useDragDrop'
import { useDirFetch } from './useDirFetch'
import { useEntryView } from './useEntryView'
import { useBrowseMutations } from './useBrowseMutations'
import { usePasteDrop } from './usePasteDrop'
import * as toast from '../services/toast'

// ---------------------------------------------------------------------------
// Module-level helpers (no JSX, no external deps)
// ---------------------------------------------------------------------------
// Operation results surface as transient toasts instead of an inline banner
// below the breadcrumb (which shifted the layout). Module-scoped so it keeps a
// stable identity (no hook-dep churn) while preserving the old { ok, msg } |
// null shape — every existing call site, and useDragDrop, works unchanged;
// null is a no-op since toasts auto-dismiss.
function setStatus(s) {
  if (s?.msg) toast.show({ msg: s.msg, type: s.ok ? 'success' : 'error' })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useBrowse({ onHistoryPush, browseRestore, onBrowseRestoreConsumed, connectionsProp = null, connectionId = null }) {
  const [connections,     setConnections]     = useState([])
  const [selectedId,      setSelectedId]      = useState(null)
  const [path,            setPath]            = useState('/')
  const [confirmTarget,   setConfirmTarget]   = useState(null)
  const [editingFile,     setEditingFile]     = useState(null)
  const [deleteTarget,    setDeleteTarget]    = useState(null)
  const [moveTarget,      setMoveTarget]      = useState(null)
  const [newFolderName,   setNewFolderName]   = useState(null)
  const [viewMode,        setViewMode]        = useState(() => localStorage.getItem('browse-view') ?? 'list')
  const [selectedFile,    setSelectedFile]    = useState(null)
  const [showQuickLook,   setShowQuickLook]   = useState(false)
  const [lastVisitedDir,  setLastVisitedDir]  = useState(null)
  const [highlightFile,   setHighlightFile]   = useState(null)
  // Entry name at the top of whichever view is currently mounted. Saved
  // by the active view on unmount so the other view can restore the same
  // scroll position when the user toggles between list and grid mid-scroll.
  const [scrollAnchor,    setScrollAnchor]    = useState(null)
  // Entry name currently targeted by type-to-jump. Distinct from
  // highlightFile (which is a slow shimmer used for things like
  // just-uploaded files); the cursor snaps with a solid accent tint
  // and is meant to keep up with rapid keystrokes.
  const [cursorEntry,     setCursorEntry]     = useState(null)
  const [bulkAction,      setBulkAction]      = useState(null)
  const [bulkMoveDest,    setBulkMoveDest]    = useState('')
  const [settingsLoaded,  setSettingsLoaded]  = useState(false)
  const dirsFirstRef       = useRef(true)
  const sortPersistRef     = useRef('default')
  const cancelledRef       = useRef(false)
  const browseRestoreRef  = useRef(browseRestore)
  const prevPath          = useRef(path)
  const initialPushed     = useRef(false)
  const pathRef           = useRef(path)
  const cacheModeRef = useRef('stale')
  const cacheMutRef  = useRef('update')

  browseRestoreRef.current = browseRestore
  pathRef.current          = path

  // Load browse settings once on mount. The refs above hold defaults until this
  // resolves, and filling a ref triggers no render — so settingsLoaded is the
  // render-visible signal that the real values are in place, for sub-hooks whose
  // effects must not act on a default they would otherwise never re-read.
  useEffect(() => {
    window.winraid?.config.get('browse').then((browse) => {
      if (browse?.cacheMode)        cacheModeRef.current   = browse.cacheMode
      if (browse?.cacheMutation)    cacheMutRef.current     = browse.cacheMutation
      if (browse?.dirsFirst != null) dirsFirstRef.current   = browse.dirsFirst
      if (browse?.sortPersistence)  sortPersistRef.current  = browse.sortPersistence
    }).catch(() => {}).finally(() => setSettingsLoaded(true))
  }, [])

  // ── Persistence ────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('browse-view', viewMode)
  }, [viewMode])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  // Reset on (re-)mount so React 18 StrictMode's double-invocation of cleanup
  // doesn't leave cancelledRef stuck as true, which would cause every bulk op
  // to break out before touching its first entry (opInFlight still clears via
  // the handlers' finally blocks, but the op would silently do nothing).
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // ── Sync connections from parent (keeps hook in step when user edits a connection) ──
  useEffect(() => {
    if (connectionsProp && connectionsProp.length > 0) setConnections(connectionsProp)
  }, [connectionsProp])

  // ── Restore from history ───────────────────────────────────────────────────
  // `path` is intentionally excluded from deps. The `token` field on browseRestore
  // (set to Date.now() by the caller) guarantees this effect re-runs on every
  // history navigation even when browseRestore.path equals the current path.
  // Including `path` would cause a feedback loop: setPath() triggers another run
  // of this effect, which re-reads the stale pre-navigation `path` for the
  // parent-highlight comparison. If the token pattern is ever removed, this
  // comparison must be rethought. See eslint-disable comment on the path check.
  useEffect(() => {
    if (!browseRestore) return

    if (browseRestore.connectionId && browseRestore.connectionId !== selectedId) {
      setSelectedId(browseRestore.connectionId)
      setEntries([])
      setError('')
      setStatus(null)
    }

    if (browseRestore.path !== path) { // eslint-disable-line react-hooks/exhaustive-deps
      if (path.startsWith(browseRestore.path) && path !== browseRestore.path) {
        const remainder = path.slice(browseRestore.path === '/' ? 1 : browseRestore.path.length + 1)
        const immediateChild = remainder.split('/')[0]
        setLastVisitedDir(immediateChild || null)
      } else {
        setLastVisitedDir(null)
      }
      setPath(browseRestore.path)
      setEntries([])
    }
    if (browseRestore.quickLookFile) {
      setSelectedFile(browseRestore.quickLookFile)
      setShowQuickLook(true)
    } else {
      setShowQuickLook(false)
      setSelectedFile(null)
    }
    if (browseRestore.highlightFile) {
      setHighlightFile(browseRestore.highlightFile)
    }
    // Signal the parent that this restore has been applied so it can clear
    // browseRestore to null. This prevents the signal from re-firing if the
    // user leaves and returns to this tab.
    onBrowseRestoreConsumed?.()
  }, [browseRestore]) // token on browseRestore ensures this fires even if path is same

  // ── Clear highlight + scroll anchor + cursor on navigation ────────────
  // The search query and the sort mode are reset by useEntryView, which owns them.
  useEffect(() => {
    if (prevPath.current !== path) {
      if (!browseRestore?.highlightFile) setHighlightFile(null)
      setScrollAnchor(null)
      setCursorEntry(null)
    }
    prevPath.current = path
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll highlighted entry into view ────────────────────────────────────
  // Scrolling to the highlighted entry is handled by each view's virtualizer
  // (scrollToIndex in BrowseList / BrowseGrid). This ref is kept so components
  // can attach it for future use, but no scroll logic runs here.
  const highlightRef = useCallback(() => {}, [])

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const restore = browseRestoreRef.current  // snapshot before any await — ref may be nulled by restore effect
      const conns = await window.winraid?.config.get('connections') ?? []
      setConnections(conns)
      if (restore?.connectionId && conns.find((c) => c.id === restore.connectionId)) {
        setSelectedId(restore.connectionId)
        if (restore.path) setPath(restore.path)
        return
      }
      // Prefer the connectionId prop (scopes this tab to a specific connection),
      // then fall back to first connection in the list.
      const initial = conns.find((c) => c.id === connectionId) ?? conns[0] ?? null
      setSelectedId(initial?.id ?? null)
      if (initial?.sftp?.remotePath) setPath(initial.sftp.remotePath)
    }
    load().then(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- connectionId is stable for the tab lifetime

  // Push initial browse history entry
  useEffect(() => {
    if (initialPushed.current || !selectedId) return
    initialPushed.current = true
    onHistoryPush?.({ kind: 'browse', path, quickLookFile: null, connectionId })
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close QuickLook on Escape ─────────────────────────────────────────────
  useEffect(() => {
    if (!showQuickLook) return
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowQuickLook(false)
        setSelectedFile(null)
        onHistoryPush?.({ kind: 'browse', path: pathRef.current, quickLookFile: null, connectionId })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [showQuickLook, onHistoryPush, connectionId]) // eslint-disable-line react-hooks/exhaustive-deps -- pathRef is a ref

  // ── Sub-hook composition: directory listing ────────────────────────────────
  // Sits above the derived values because filteredEntries and every mutation
  // handler below read entries/setEntries/entriesRef/fetchDir from here.
  const { entries, setEntries, entriesRef, loading, error, fetchDir } = useDirFetch({
    selectedId,
    path,
    connections,
    cacheModeRef,
    settingsLoaded,
    setStatus,
    setHighlightFile,
  })

  // ── Derived values ─────────────────────────────────────────────────────────
  const selectedConn  = connections.find((c) => c.id === selectedId) ?? null
  const cfgRemotePath = selectedConn?.sftp?.remotePath ?? ''
  const localFolder   = selectedConn?.localFolder ?? ''

  const crumbs = useMemo(() => {
    const parts = path.split('/').filter(Boolean)
    const result = [{ label: 'root', path: '/' }]
    let built = ''
    for (const p of parts) {
      built += '/' + p
      result.push({ label: p, path: built })
    }
    return result
  }, [path])

  // ── Sub-hook composition: sort, search, and the lists the views render ─────
  // Sits above useSelection because the views pass row indexes into the
  // filtered list, so useSelection must resolve them against the same list.
  const {
    sortMode, setSortMode,
    searchQuery, setSearchQuery,
    filteredEntries, fileEntries, entriesWithPaths,
    dirCount, fileCount,
  } = useEntryView({ entries, path, dirsFirstRef, sortPersistRef })

  // ── Handlers ───────────────────────────────────────────────────────────────
  const navigate = useCallback((newPath) => {
    const curPath = pathRef.current
    if (curPath.startsWith(newPath) && curPath !== newPath) {
      const remainder = curPath.slice(newPath === '/' ? 1 : newPath.length + 1)
      const immediateChild = remainder.split('/')[0]
      setLastVisitedDir(immediateChild || null)
    } else {
      setLastVisitedDir(null)
    }
    setPath(newPath)
    setEntries([])
    setShowQuickLook(false)
    setSelectedFile(null)
    onHistoryPush?.({ kind: 'browse', path: newPath, quickLookFile: null, connectionId })
  }, [onHistoryPush])

  // Copy a remote path to the clipboard (used by the current-dir breadcrumb).
  const copyPath = useCallback(async (p = pathRef.current) => {
    try {
      await navigator.clipboard.writeText(p)
      setStatus({ ok: true, msg: `Copied path: ${p}` })
    } catch {
      setStatus({ ok: false, msg: 'Failed to copy path' })
    }
  }, [])

  const openQuickLook = useCallback((entry, entryPath) => {
    setSelectedFile({ ...entry, path: entryPath })
    setShowQuickLook(true)
    onHistoryPush?.({ kind: 'browse', path: pathRef.current, quickLookFile: { ...entry, path: entryPath }, connectionId })
  }, [onHistoryPush])

  // ── Sub-hook composition ───────────────────────────────────────────────────
  const selection = useSelection({ entries: filteredEntries, path })

  const dragDrop = useDragDrop({
    selected: selection.selected,
    entries:  entriesWithPaths,
    selectedId,
    path,
    viewMode,
    fetchDir,
    navigate,
    setStatus,
    clearSelection: selection.clearSelection,
  })

  // ── Sub-hook composition: remote writes and downloads ──────────────────────
  // Sits below useSelection because the bulk operations act on the current
  // selection, and below useDirFetch because every write reconciles the cache
  // against the listing it fetched.
  const {
    opInFlight, setOpInFlight,
    downloadProgress,
    handleCheckout, handleConfirm, handleSetRoot,
    handleDownload,
    handleDelete, handleMove, handleCreateFolder,
    selectedEntries,
    handleBulkDelete, handleBulkMove, handleBulkCheckout,
  } = useBrowseMutations({
    selectedId,
    selectedConn,
    connections,
    setConnections,
    cfgRemotePath,
    localFolder,
    path,
    entries,
    entriesRef,
    setEntries,
    fetchDir,
    selection,
    cacheMutRef,
    cancelledRef,
    setStatus,
    setHighlightFile,
    setConfirmTarget,
    setDeleteTarget,
    setMoveTarget,
    newFolderName,
    setNewFolderName,
    setBulkAction,
    bulkMoveDest,
    setBulkMoveDest,
  })

  // ── Sub-hook composition: inbound files (clipboard paste, external drop) ───
  // Sits below useBrowseMutations because the paste write shares its in-flight
  // flag, and below useDirFetch because it reconciles the cache and pushes the
  // refreshed listing back into entries.
  const pasteDrop = usePasteDrop({
    selectedId,
    selectedConn,
    path,
    fetchDir,
    setEntries,
    setOpInFlight,
    setStatus,
    setHighlightFile,
  })

  // ── Derived values (depend on sub-hooks) ───────────────────────────────────
  const busy     = opInFlight || !!dragDrop.moveInFlight
  const noConfig = !selectedId || (!selectedConn?.sftp?.host && !browseRestore?.connectionId)

  return {
    // useBrowse own state/handlers
    connections, selectedId, path, entries, loading, error,
    opInFlight, downloadProgress, confirmTarget, editingFile, deleteTarget, moveTarget,
    newFolderName, viewMode, selectedFile, showQuickLook,
    lastVisitedDir, highlightFile,
    scrollAnchor, setScrollAnchor,
    searchQuery, setSearchQuery,
    cursorEntry, setCursorEntry,
    sortMode, setSortMode,
    bulkAction, bulkMoveDest,
    setEditingFile, setViewMode, setNewFolderName, setConfirmTarget,
    setDeleteTarget, setMoveTarget, setBulkAction, setBulkMoveDest,
    setSelectedFile, setShowQuickLook, setHighlightFile,
    selectedConn, cfgRemotePath, localFolder, crumbs,
    fileEntries, entriesWithPaths, dirCount, fileCount, busy, noConfig, selectedEntries,
    highlightRef,
    fetchDir, navigate, copyPath, openQuickLook,
    handleCheckout, handleConfirm, handleSetRoot,
    handleDownload,
    handleDelete, handleMove, handleCreateFolder,
    handleBulkDelete, handleBulkMove, handleBulkCheckout,
    // Sub-hook APIs — spread flat for backward compatibility
    ...pasteDrop,
    ...selection,
    ...dragDrop,
  }
}
