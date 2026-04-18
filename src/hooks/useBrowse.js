import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSelection } from './useSelection'
import { useDragDrop } from './useDragDrop'

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
export function useBrowse({ onHistoryPush, browseRestore, onBrowseRestoreConsumed, connectionsProp = null, connectionId = null }) {
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
  const [lastVisitedDir,  setLastVisitedDir]  = useState(null)
  const [highlightFile,   setHighlightFile]   = useState(null)
  const [bulkAction,      setBulkAction]      = useState(null)
  const [bulkMoveDest,    setBulkMoveDest]    = useState('')
  const [downloadProgress, setDownloadProgress] = useState(null)
  // shape: null | { name, filesProcessed, totalFiles, bytesTransferred, totalBytes }
  const [externalDropActive, setExternalDropActive] = useState(false)
  const cancelledRef      = useRef(false)
  const browseRestoreRef  = useRef(browseRestore)
  const prevPath          = useRef(path)
  const initialPushed     = useRef(false)
  const pathRef           = useRef(path)

  browseRestoreRef.current = browseRestore
  pathRef.current          = path

  // ── Persistence ────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('browse-view', viewMode)
  }, [viewMode])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  // Reset on (re-)mount so React 18 StrictMode's double-invocation of cleanup
  // doesn't leave cancelledRef stuck as true, which would cause all bulk ops
  // to skip setOpInFlight(false) and leave busy permanently true.
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — connectionId is stable for the tab lifetime

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
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showQuickLook, onHistoryPush, connectionId]) // eslint-disable-line react-hooks/exhaustive-deps — pathRef is a ref

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

  // ── Handlers ───────────────────────────────────────────────────────────────
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

  useEffect(() => {
    if (!window.winraid) return
    return window.winraid.remote.onDownloadProgress((payload) => {
      if (payload.connectionId !== selectedId) return
      setDownloadProgress({
        name: payload.name,
        filesProcessed: payload.filesProcessed,
        totalFiles: payload.totalFiles,
        bytesTransferred: payload.bytesTransferred,
        totalBytes: payload.totalBytes,
      })
    })
  }, [selectedId])

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

  const openQuickLook = useCallback((entry, entryPath) => {
    setSelectedFile({ ...entry, path: entryPath })
    setShowQuickLook(true)
    onHistoryPush?.({ kind: 'browse', path: pathRef.current, quickLookFile: { ...entry, path: entryPath }, connectionId })
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

  const handleDownload = useCallback(async (remotePath, entryName, isDir) => {
    if (!selectedId || opInFlight) return
    const localPath = await window.winraid?.selectDownloadPath(entryName, isDir)
    if (!localPath) return
    setOpInFlight(true)
    setStatus(null)
    setDownloadProgress(null)
    const res = await window.winraid?.remote.download(selectedId, remotePath, localPath, isDir)
    setDownloadProgress(null)
    setOpInFlight(false)
    if (res?.ok) {
      setStatus({ ok: true, msg: isDir ? `Downloaded ${res.count} file(s) to ${localPath}` : `Downloaded to ${localPath}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Download failed' })
    }
  }, [selectedId, opInFlight])

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
    let res
    try {
      res = await window.winraid?.remote.delete(selectedId, target.path, target.isDir)
    } finally {
      setOpInFlight(false)
    }
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
    let res
    try {
      res = await window.winraid?.remote.move(selectedId, srcPath, dstPath)
    } finally {
      setOpInFlight(false)
    }
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

  // ── Sub-hook composition ───────────────────────────────────────────────────
  const selection = useSelection({ entries, path })

  const dragDrop = useDragDrop({
    selected: selection.selected,
    entries:  entriesWithPaths,
    selectedId,
    path,
    viewMode,
    fetchDir,
    navigate,
    setStatus,
  })

  const handleExternalDragOver = useCallback((e) => {
    if (dragDrop.dragSource) return
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    setExternalDropActive(true)
  }, [dragDrop.dragSource])

  const handleExternalDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setExternalDropActive(false)
    }
  }, [])

  const handleExternalDrop = useCallback(async (e) => {
    e.preventDefault()
    setExternalDropActive(false)
    if (!selectedId) return
    const localPaths = Array.from(e.dataTransfer?.files ?? [])
      .map((f) => f.path)
      .filter(Boolean)
    if (!localPaths.length) return
    await window.winraid?.queue.dropUpload(selectedId, pathRef.current, localPaths)
  }, [selectedId])

  // ── Derived values (depend on sub-hooks) ───────────────────────────────────
  const dirCount  = useMemo(() => entries.filter((e) => e.type === 'dir').length, [entries])
  const fileCount = entries.length - dirCount

  const busy     = opInFlight || !!dragDrop.moveInFlight
  const noConfig = !selectedId || (!selectedConn?.sftp?.host && !browseRestore?.connectionId)

  const selectedEntries = useMemo(
    () => entries.filter((e) => selection.selected.has(e.name)),
    [entries, selection.selected],
  )

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
    selection.clearSelection()
    await fetchDir(path)
    if (fail === 0) {
      setStatus({ ok: true, msg: `Deleted ${ok} item${ok !== 1 ? 's' : ''}` })
    } else {
      setStatus({ ok: false, msg: `Deleted ${ok}, failed ${fail}` })
    }
  }, [selectedEntries, selectedId, path, fetchDir, selection])

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
    selection.clearSelection()
    await fetchDir(path)
    if (fail === 0) {
      setStatus({ ok: true, msg: `Moved ${ok} item${ok !== 1 ? 's' : ''} to ${dest}` })
    } else {
      setStatus({ ok: false, msg: `Moved ${ok}, failed ${fail}` })
    }
  }, [bulkMoveDest, selectedEntries, selectedId, path, fetchDir, selection])

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
    selection.clearSelection()
    if (fail === 0) {
      setStatus({ ok: true, msg: `Downloaded ${ok} item${ok !== 1 ? 's' : ''}` })
    } else {
      setStatus({ ok: false, msg: `Downloaded ${ok}, failed ${fail}` })
    }
  }, [selectedId, localFolder, selectedEntries, selection])

  return {
    // useBrowse own state/handlers
    connections, selectedId, path, entries, loading, error, status,
    opInFlight, downloadProgress, confirmTarget, editingFile, deleteTarget, moveTarget,
    newFolderName, viewMode, selectedFile, showQuickLook,
    lastVisitedDir, highlightFile,
    bulkAction, bulkMoveDest,
    setEditingFile, setViewMode, setNewFolderName, setConfirmTarget,
    setDeleteTarget, setMoveTarget, setBulkAction, setBulkMoveDest,
    setSelectedFile, setShowQuickLook,
    selectedConn, cfgRemotePath, localFolder, crumbs,
    fileEntries, entriesWithPaths, dirCount, fileCount, busy, noConfig, selectedEntries,
    highlightRef,
    fetchDir, navigate, openQuickLook,
    handleCheckout, handleConfirm, handleSetRoot,
    handleDownload,
    handleDelete, handleMove, handleCreateFolder,
    handleBulkDelete, handleBulkMove, handleBulkCheckout,
    externalDropActive,
    handleExternalDragOver,
    handleExternalDragLeave,
    handleExternalDrop,
    // Sub-hook APIs — spread flat for backward compatibility
    ...selection,
    ...dragDrop,
  }
}
