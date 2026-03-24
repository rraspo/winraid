import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

// ---------------------------------------------------------------------------
// Module-level helpers (no JSX, no external deps)
// ---------------------------------------------------------------------------
function joinRemote(base, name) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

function isOutsideRoot(remotePath, cfgRemotePath) {
  if (!cfgRemotePath) return false
  const base = cfgRemotePath.replace(/\/+$/, '')
  return remotePath !== base && !remotePath.startsWith(base + '/')
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useBrowse({ onHistoryPush, browseRestore, connectionsProp = null, activeConnIdProp = null }) {
  const [connections,     setConnections]     = useState([])
  const [selectedId,      setSelectedId]      = useState(null)
  const [path,            setPath]            = useState('/')
  const [entries,         setEntries]         = useState([])
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState('')
  const [status,          setStatus]          = useState(null)
  const [opInFlight,      setOpInFlight]      = useState(false)
  const [confirmTarget,   setConfirmTarget]   = useState(null)
  const [editingFile,     setEditingFile]     = useState(null)
  const [deleteTarget,    setDeleteTarget]    = useState(null)
  const [moveTarget,      setMoveTarget]      = useState(null)
  const [newFolderName,   setNewFolderName]   = useState(null)
  const [viewMode,        setViewMode]        = useState(() => localStorage.getItem('browse-view') ?? 'list')
  const [selectedFile,    setSelectedFile]    = useState(null)
  const [showQuickLook,   setShowQuickLook]   = useState(false)
  const [dragSource,      setDragSource]      = useState(null)
  const [moveInFlight,    setMoveInFlight]    = useState(null)
  const [lastVisitedDir,  setLastVisitedDir]  = useState(null)
  const [highlightFile,   setHighlightFile]   = useState(null)
  const [selected,        setSelected]        = useState(new Set())
  const [bulkAction,      setBulkAction]      = useState(null)
  const [bulkMoveDest,    setBulkMoveDest]    = useState('')
  const dwellTimer        = useRef(null)
  const cancelledRef      = useRef(false)
  const browseRestoreRef  = useRef(browseRestore)
  const prevPath          = useRef(path)
  const initialPushed     = useRef(false)
  // Latest-value refs — updated every render so event handlers can read current
  // state without capturing stale closures or needing them in useCallback deps.
  const dragSourceRef     = useRef(dragSource)
  // dropTargetPathRef is the sole source of truth for the current drop target —
  // there is no mirroring state. Handlers update it directly and apply the
  // highlight via DOM attribute manipulation to avoid re-rendering the tree.
  const dropTargetPathRef = useRef(null)
  const pathRef           = useRef(path)

  browseRestoreRef.current = browseRestore
  dragSourceRef.current    = dragSource
  pathRef.current          = path

  // ── Persistence ────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('browse-view', viewMode)
  }, [viewMode])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    cancelledRef.current = true
    clearTimeout(dwellTimer.current)
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
  }, [browseRestore]) // token on browseRestore ensures this fires even if path is same

  // ── Clear highlight on navigation ─────────────────────────────────────────
  useEffect(() => {
    if (prevPath.current !== path && !browseRestore?.highlightFile) {
      setHighlightFile(null)
    }
    prevPath.current = path
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll highlighted entry into view ────────────────────────────────────
  const highlightRef = useCallback((node) => {
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const conns    = await window.winraid?.config.get('connections') ?? []
      const activeId = await window.winraid?.config.get('activeConnectionId')
      setConnections(conns)
      const restore = browseRestoreRef.current
      if (restore?.connectionId && conns.find((c) => c.id === restore.connectionId)) {
        setSelectedId(restore.connectionId)
        if (restore.path) setPath(restore.path)
        return
      }
      const initial = conns.find((c) => c.id === activeId) ?? conns[0] ?? null
      setSelectedId(initial?.id ?? null)
      if (initial?.sftp?.remotePath) setPath(initial.sftp.remotePath)
    }
    load().then(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Push initial browse history entry
  useEffect(() => {
    if (initialPushed.current || !selectedId) return
    initialPushed.current = true
    onHistoryPush?.({ kind: 'browse', path, quickLookFile: null })
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const fileEntries = useMemo(
    () => entries
      .filter((e) => e.type !== 'dir')
      .map((e) => ({ ...e, path: joinRemote(path, e.name) })),
    [entries, path],
  )

  const entriesWithPaths = useMemo(
    () => entries.map((e) => ({ ...e, entryPath: joinRemote(path, e.name) })),
    [entries, path],
  )

  const dirCount  = useMemo(() => entries.filter((e) => e.type === 'dir').length, [entries])
  const fileCount = entries.length - dirCount

  const busy     = opInFlight || !!moveInFlight
  const noConfig = !selectedId || (!selectedConn?.sftp?.host && !browseRestore?.connectionId)

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(e.name)),
    [entries, selected],
  )

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSelectConnection = useCallback((id) => {
    const conn = connections.find((c) => c.id === id)
    if (!conn) return
    setSelectedId(id)
    setEntries([])
    setError('')
    setStatus(null)
    const newPath = conn.sftp?.remotePath || '/'
    setPath(newPath)
    onHistoryPush?.({ kind: 'browse', path: newPath, quickLookFile: null })
  }, [connections, onHistoryPush])

  const fetchDir = useCallback(async (targetPath) => {
    if (!selectedId) return
    setLoading(true)
    setError('')
    setStatus(null)
    const res = await window.winraid?.remote.list(selectedId, targetPath)
    setLoading(false)
    if (res?.ok) {
      setEntries(res.entries)
    } else {
      setError(res?.error || 'Failed to list directory')
      setEntries([])
    }
  }, [selectedId])

  useEffect(() => {
    if (selectedId) fetchDir(path)
  }, [selectedId, path, fetchDir])

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
    onHistoryPush?.({ kind: 'browse', path: newPath, quickLookFile: null })
  }, [onHistoryPush])

  const openQuickLook = useCallback((entry, entryPath) => {
    setSelectedFile({ ...entry, path: entryPath })
    setShowQuickLook(true)
    onHistoryPush?.({ kind: 'browse', path: pathRef.current, quickLookFile: { ...entry, path: entryPath } })
  }, [onHistoryPush])

  const doCheckout = useCallback(async (remotePath, clearFirst = false, targetFolder = localFolder, newSyncRoot = null) => {
    setOpInFlight(true)
    setStatus(null)
    if (clearFirst) {
      const clearRes = await window.winraid?.local.clearFolder(targetFolder)
      if (!clearRes?.ok) {
        setOpInFlight(false)
        setStatus({ ok: false, msg: `Failed to clear watch folder: ${clearRes?.error}` })
        return
      }
    }
    const res = await window.winraid?.remote.checkout(selectedId, remotePath, targetFolder)
    setOpInFlight(false)
    if (res?.ok) {
      if (newSyncRoot && selectedConn) {
        const updatedConns = connections.map((c) =>
          c.id === selectedConn.id
            ? { ...c, sftp: { ...c.sftp, remotePath: newSyncRoot } }
            : c
        )
        await window.winraid?.config.set('connections', updatedConns)
        setConnections(updatedConns)
      }
      setStatus({ ok: true, msg: `Created ${res.created?.length ?? 0} folder(s) under ${targetFolder}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Checkout failed' })
    }
  }, [selectedId, selectedConn, connections, localFolder])

  const handleCheckout = useCallback((remotePath) => {
    if (!selectedId || !localFolder || opInFlight) return
    if (isOutsideRoot(remotePath, cfgRemotePath)) {
      setConfirmTarget(remotePath)
    } else {
      doCheckout(remotePath)
    }
  }, [selectedId, localFolder, opInFlight, cfgRemotePath, doCheckout])

  const handleConfirm = useCallback((checkoutPath, targetFolder, newSyncRoot) => {
    setConfirmTarget(null)
    doCheckout(checkoutPath, true, targetFolder, newSyncRoot)
  }, [doCheckout])

  const handleSetRoot = useCallback(async (remotePath) => {
    if (!selectedId || !selectedConn) return
    const updatedConns = connections.map((c) =>
      c.id === selectedConn.id
        ? { ...c, sftp: { ...c.sftp, remotePath } }
        : c
    )
    await window.winraid?.config.set('connections', updatedConns)
    setConnections(updatedConns)
    setStatus({ ok: true, msg: `Sync root updated to ${remotePath}` })
  }, [selectedId, selectedConn, connections])

  const handleDelete = useCallback(async (target) => {
    setDeleteTarget(null)
    setOpInFlight(true)
    setStatus(null)
    const res = await window.winraid?.remote.delete(selectedId, target.path, target.isDir)
    setOpInFlight(false)
    if (res?.ok) {
      setEntries((prev) => prev.filter((e) => e.name !== target.name))
      setStatus({ ok: true, msg: `Deleted ${target.path}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Delete failed' })
      fetchDir(path)
    }
  }, [selectedId, path, fetchDir])

  const handleMove = useCallback(async (srcPath, dstPath) => {
    setMoveTarget(null)
    setOpInFlight(true)
    setStatus(null)
    const res = await window.winraid?.remote.move(selectedId, srcPath, dstPath)
    setOpInFlight(false)
    await fetchDir(path)
    if (res?.ok) {
      setStatus({ ok: true, msg: `Moved to ${dstPath}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Move failed' })
    }
  }, [selectedId, path, fetchDir])

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName?.trim()
    if (!name || !selectedId) return
    setNewFolderName(null)
    setOpInFlight(true)
    setStatus(null)
    const folderPath = joinRemote(path, name)
    const res = await window.winraid?.remote.mkdir(selectedId, folderPath)
    setOpInFlight(false)
    if (res?.ok) {
      await fetchDir(path)
      setStatus({ ok: true, msg: `Created folder ${name}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Failed to create folder' })
    }
  }, [newFolderName, selectedId, path, fetchDir])

  // ── Selection ──────────────────────────────────────────────────────────────
  const toggleSelect = useCallback((name, e) => {
    if (e) e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selected.size === entries.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(entries.map((e) => e.name)))
    }
  }, [selected, entries])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  useEffect(() => { setSelected(new Set()) }, [path])

  // ── Bulk operations ────────────────────────────────────────────────────────
  const handleBulkDelete = useCallback(async () => {
    setBulkAction(null)
    setOpInFlight(true)
    setStatus(null)
    let ok = 0, fail = 0
    for (const entry of selectedEntries) {
      if (cancelledRef.current) break
      const entryPath = joinRemote(path, entry.name)
      const isDir = entry.type === 'dir'
      const res = await window.winraid?.remote.delete(selectedId, entryPath, isDir)
      if (res?.ok) ok++
      else fail++
    }
    if (cancelledRef.current) return
    setOpInFlight(false)
    clearSelection()
    await fetchDir(path)
    if (fail === 0) {
      setStatus({ ok: true, msg: `Deleted ${ok} item${ok !== 1 ? 's' : ''}` })
    } else {
      setStatus({ ok: false, msg: `Deleted ${ok}, failed ${fail}` })
    }
  }, [selectedEntries, selectedId, path, fetchDir, clearSelection])

  const handleBulkMove = useCallback(async () => {
    const dest = bulkMoveDest.trim()
    if (!dest) return
    setBulkAction(null)
    setBulkMoveDest('')
    setOpInFlight(true)
    setStatus(null)
    let ok = 0, fail = 0
    for (const entry of selectedEntries) {
      if (cancelledRef.current) break
      const srcPath = joinRemote(path, entry.name)
      const dstPath = joinRemote(dest, entry.name)
      if (srcPath === dstPath) continue
      const res = await window.winraid?.remote.move(selectedId, srcPath, dstPath)
      if (res?.ok) ok++
      else fail++
    }
    if (cancelledRef.current) return
    setOpInFlight(false)
    clearSelection()
    await fetchDir(path)
    if (fail === 0) {
      setStatus({ ok: true, msg: `Moved ${ok} item${ok !== 1 ? 's' : ''} to ${dest}` })
    } else {
      setStatus({ ok: false, msg: `Moved ${ok}, failed ${fail}` })
    }
  }, [bulkMoveDest, selectedEntries, selectedId, path, fetchDir, clearSelection])

  const handleBulkCheckout = useCallback(async () => {
    if (!selectedId || !localFolder) return
    setOpInFlight(true)
    setStatus(null)
    let ok = 0, fail = 0
    for (const entry of selectedEntries) {
      if (cancelledRef.current) break
      const entryPath = joinRemote(path, entry.name)
      const res = await window.winraid?.remote.checkout(selectedId, entryPath, localFolder)
      if (res?.ok) ok++
      else fail++
    }
    if (cancelledRef.current) return
    setOpInFlight(false)
    clearSelection()
    if (fail === 0) {
      setStatus({ ok: true, msg: `Downloaded ${ok} item${ok !== 1 ? 's' : ''}` })
    } else {
      setStatus({ ok: false, msg: `Downloaded ${ok}, failed ${fail}` })
    }
  }, [selectedId, localFolder, selectedEntries, clearSelection])

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e, entry, entryPath) => {
    setDragSource({ name: entry.name, path: entryPath })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', entryPath)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragSource(null)
    if (dropTargetPathRef.current !== null) {
      const el = document.querySelector(`[data-entry-path="${CSS.escape(dropTargetPathRef.current)}"]`)
      if (el) el.removeAttribute('data-drop-target')
      dropTargetPathRef.current = null
    }
    clearTimeout(dwellTimer.current)
  }, [])

  // dragSourceRef and dropTargetPathRef let this stay stable during the entire
  // drag interaction — avoids recreating the handler (and re-rendering every
  // visible card) on every dragover event. Highlight is applied directly via
  // DOM attribute manipulation so no React state change (and no re-render)
  // is triggered on each dragover event.
  const handleDragOverFolder = useCallback((e, folderPath) => {
    if (!dragSourceRef.current || dragSourceRef.current.path === folderPath) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (dropTargetPathRef.current !== folderPath) {
      // Clear the previous target's attribute before setting the new one.
      if (dropTargetPathRef.current !== null) {
        const prev = document.querySelector(`[data-entry-path="${CSS.escape(dropTargetPathRef.current)}"]`)
        if (prev) prev.removeAttribute('data-drop-target')
      }
      e.currentTarget.setAttribute('data-drop-target', 'true')
      dropTargetPathRef.current = folderPath
      clearTimeout(dwellTimer.current)
      if (folderPath !== pathRef.current) {
        dwellTimer.current = setTimeout(() => navigate(folderPath), 600)
      }
    }
  }, [navigate])

  const handleDragLeaveFolder = useCallback((e) => {
    e.currentTarget.removeAttribute('data-drop-target')
    dropTargetPathRef.current = null
    clearTimeout(dwellTimer.current)
  }, [])

  const handleDrop = useCallback(async (e, targetDirPath) => {
    e.preventDefault()
    if (dropTargetPathRef.current !== null) {
      const el = document.querySelector(`[data-entry-path="${CSS.escape(dropTargetPathRef.current)}"]`)
      if (el) el.removeAttribute('data-drop-target')
      dropTargetPathRef.current = null
    }
    clearTimeout(dwellTimer.current)
    const src = dragSourceRef.current
    if (!src || !selectedId) return
    const srcPath = src.path
    if (targetDirPath === srcPath || targetDirPath.startsWith(srcPath + '/')) return
    const dstPath = joinRemote(targetDirPath, src.name)
    if (srcPath === dstPath) return
    setDragSource(null)
    setMoveInFlight({ name: src.name, from: srcPath, to: dstPath })
    setStatus(null)
    const moveName = src.name
    const res = await window.winraid?.remote.move(selectedId, srcPath, dstPath)
    setMoveInFlight(null)
    await fetchDir(path)
    if (res?.ok) {
      setStatus({ ok: true, msg: `Moved ${moveName} to ${targetDirPath}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Move failed' })
    }
  }, [selectedId, path, fetchDir])

  return {
    // State
    connections, selectedId, path, entries, loading, error, status,
    opInFlight, confirmTarget, editingFile, deleteTarget, moveTarget,
    newFolderName, viewMode, selectedFile, showQuickLook,
    dragSource, moveInFlight, lastVisitedDir, highlightFile,
    selected, bulkAction, bulkMoveDest,
    // Setters exposed for shell (modals, header buttons)
    setEditingFile, setViewMode, setNewFolderName, setConfirmTarget,
    setDeleteTarget, setMoveTarget, setBulkAction, setBulkMoveDest,
    setSelectedFile, setShowQuickLook,
    // Derived
    selectedConn, cfgRemotePath, localFolder, crumbs,
    fileEntries, entriesWithPaths, dirCount, fileCount, busy, noConfig, selectedEntries,
    // Callback ref
    highlightRef,
    // Handlers
    handleSelectConnection, fetchDir, navigate, openQuickLook,
    handleCheckout, handleConfirm, handleSetRoot,
    handleDelete, handleMove, handleCreateFolder,
    toggleSelect, toggleSelectAll, clearSelection,
    handleBulkDelete, handleBulkMove, handleBulkCheckout,
    handleDragStart, handleDragEnd, handleDragOverFolder, handleDragLeaveFolder, handleDrop,
  }
}
