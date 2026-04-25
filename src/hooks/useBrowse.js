import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSelection } from './useSelection'
import { useDragDrop } from './useDragDrop'
import * as remoteFS from '../services/remoteFS'

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
  const [mergerfsWarning,   setMergerfsWarning]   = useState(false)
  const mergerfsRootsRef  = useRef({}) // connId → Set<string>
  const cancelledRef      = useRef(false)
  const browseRestoreRef  = useRef(browseRestore)
  const prevPath          = useRef(path)
  const initialPushed     = useRef(false)
  const pathRef           = useRef(path)
  const entriesRef   = useRef([])
  const cacheModeRef = useRef('stale')
  const cacheMutRef  = useRef('update')

  browseRestoreRef.current = browseRestore
  pathRef.current          = path

  // Keep entriesRef in sync so mutation callbacks can read latest entries without
  // adding entries to their dependency arrays.
  useEffect(() => { entriesRef.current = entries }, [entries])

  // Load browse settings once on mount
  useEffect(() => {
    window.winraid?.config.get('browse').then((browse) => {
      if (browse?.cacheMode)     cacheModeRef.current = browse.cacheMode
      if (browse?.cacheMutation) cacheMutRef.current  = browse.cacheMutation
    }).catch(() => {})
  }, [])

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
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
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
    const mode = cacheModeRef.current

    if (mode === 'stale') {
      const cached = remoteFS.getSnapshot(selectedId, targetPath)
      if (cached) {
        setEntries(cached)
        setError('')
        setLoading(false)
        remoteFS.invalidate(selectedId, targetPath)
        remoteFS.list(selectedId, targetPath).then((entries) => {
          setEntries(entries)
        }).catch(() => {})
        return
      }
    } else if (mode === 'tree') {
      const cached = remoteFS.getSnapshot(selectedId, targetPath)
      if (cached) {
        setEntries(cached)
        setError('')
        setLoading(false)
        setStatus(null)
        return
      }
    }

    setLoading(true)
    setError('')
    setStatus(null)
    try {
      const entries = await remoteFS.list(selectedId, targetPath)
      setLoading(false)
      setEntries(entries)
    } catch (err) {
      setLoading(false)
      setError(err.message || 'Failed to list directory')
      setEntries([])
    }
  }, [selectedId])

  useEffect(() => {
    if (selectedId) fetchDir(path)
  }, [selectedId, path, fetchDir])

  // When cacheMode is 'tree', walk the full remote tree via SSH exec on connection.
  // SFTP-only — SMB connections are silently skipped.
  useEffect(() => {
    if (!selectedId || cacheModeRef.current !== 'tree') return
    const conn = connections.find((c) => c.id === selectedId)
    if (conn?.type !== 'sftp' || !conn?.sftp?.remotePath) return
    const rootPath = conn.sftp.remotePath.replace(/\/+$/, '') || '/'
    remoteFS.tree(selectedId, rootPath).catch(() => {})
  }, [selectedId, connections])

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
      if (cacheMutRef.current === 'update') {
        remoteFS.update(selectedId, path, (entries) => entries.filter((e) => e.name !== target.name))
      } else {
        remoteFS.invalidate(selectedId, path)
      }
      setEntries((prev) => prev.filter((e) => e.name !== target.name))
      setStatus({ ok: true, msg: `Deleted ${target.path}` })
    } else {
      remoteFS.invalidate(selectedId, path)
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
    if (res?.ok) {
      if (cacheMutRef.current === 'update') {
        const srcName    = srcPath.split('/').at(-1)
        const dstName    = dstPath.split('/').at(-1)
        const dstDir     = dstPath.split('/').slice(0, -1).join('/') || '/'
        const movedEntry = entriesRef.current.find((e) => e.name === srcName)
        remoteFS.update(selectedId, path, (entries) => entries.filter((e) => e.name !== srcName))
        setEntries((prev) => prev.filter((e) => e.name !== srcName))
        if (movedEntry) {
          remoteFS.update(selectedId, dstDir, (entries) => {
            const updated = [...entries, { ...movedEntry, name: dstName }]
            return updated.sort((a, b) => {
              if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
              return a.name.localeCompare(b.name)
            })
          })
        }
        setStatus({ ok: true, msg: `Moved to ${dstPath}` })
      } else {
        remoteFS.invalidate(selectedId, path)
        await fetchDir(path)
        setStatus({ ok: true, msg: `Moved to ${dstPath}` })
      }
    } else {
      remoteFS.invalidate(selectedId, path)
      await fetchDir(path)
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
      setHighlightFile(name)
      if (cacheMutRef.current === 'update') {
        const newEntry = { name, type: 'dir', size: 0, modified: Date.now() }
        const splice = (arr) => [...arr, newEntry].sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        setEntries((prev) => splice(prev))
        remoteFS.update(selectedId, path, splice)
      } else {
        remoteFS.invalidate(selectedId, path)
        await fetchDir(path)
      }
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

  // Counter tracks how many nested dragenter/dragleave pairs are in flight.
  // relatedTarget can be null when crossing pointer-events:none elements (the
  // overlay cards), which would falsely trigger deactivation — the counter
  // approach is immune to that because it counts crossing events, not targets.
  const dragCounterRef = useRef(0)

  const isInternalDrag = (e) => e.dataTransfer?.types?.includes('application/x-winraid-internal')

  const handleExternalDragEnter = useCallback((e) => {
    if (isInternalDrag(e)) return
    if (!e.dataTransfer?.types?.includes('Files')) return
    dragCounterRef.current += 1
    if (!mergerfsWarning) setExternalDropActive(true)
  }, [mergerfsWarning])

  const handleExternalDragOver = useCallback((e) => {
    if (isInternalDrag(e)) return
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    if (!mergerfsWarning) setExternalDropActive(true)
  }, [mergerfsWarning])

  const handleExternalDragLeave = useCallback((e) => {
    if (isInternalDrag(e)) return
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setExternalDropActive(false)
    }
  }, [])

  const handleExternalDrop = useCallback(async (e) => {
    if (isInternalDrag(e)) return
    e.preventDefault()
    dragCounterRef.current = 0
    setExternalDropActive(false)
    if (!selectedId || mergerfsWarning) return
    const localPaths = Array.from(e.dataTransfer?.files ?? [])
      .map((f) => window.winraid?.getPathForFile?.(f) ?? '')
      .filter(Boolean)
    if (!localPaths.length) return
    await window.winraid?.queue.dropUpload(selectedId, pathRef.current, localPaths)
  }, [selectedId, mergerfsWarning])

  // Stable ref so the queue:updated subscription never needs to re-create just
  // because fetchDir changed — avoids missing the DONE event during re-renders.
  const fetchDirRef = useRef(fetchDir)
  fetchDirRef.current = fetchDir

  // Refresh the directory listing when a drop-upload job completes.
  // For drop-uploads: also highlight the file if the user is still in the same dir.
  useEffect(() => {
    if (!selectedId) return
    return window.winraid?.queue.onUpdated((payload) => {
      const { type, job } = payload
      if (type !== 'updated' || job?.status !== 'DONE' || job?.connectionId !== selectedId) return
      if (job.remoteDest) {
        const relPath  = job.relPath ?? ''
        const lastSlash = relPath.lastIndexOf('/')
        const fileDir  = lastSlash === -1
          ? job.remoteDest.replace(/\/+$/, '')
          : `${job.remoteDest.replace(/\/+$/, '')}/${relPath.slice(0, lastSlash)}`
        if (fileDir === pathRef.current.replace(/\/+$/, '')) {
          setHighlightFile(job.filename)
        }
      }
      fetchDirRef.current(pathRef.current)
    })
  }, [selectedId])

  // ── mergerfs root detection ─────────────────────────────────────────────────
  // Read /proc/mounts once per SFTP connection, cache per connId. Non-SFTP or
  // unreadable mounts are treated as non-mergerfs (no warning, no block).
  useEffect(() => {
    if (!selectedId || selectedConn?.type !== 'sftp') {
      setMergerfsWarning(false)
      return
    }

    function checkPath(roots) {
      const p = pathRef.current.replace(/\/+$/, '') || '/'
      setMergerfsWarning(roots.has(p))
    }

    const cached = mergerfsRootsRef.current[selectedId]
    if (cached !== undefined) { checkPath(cached); return }

    let cancelled = false
    window.winraid?.remote.readFile(selectedId, '/proc/mounts')
      ?.then((res) => {
        if (cancelled) return
        const roots = new Set()
        if (res?.ok && res.content) {
          for (const line of res.content.split('\n')) {
            const parts = line.trim().split(/\s+/)
            // fuse.mergerfs = standard mergerfs; fuse.shfs = Unraid's shfs (same concept)
            if (parts[2] === 'fuse.mergerfs' || parts[2] === 'fuse.shfs') roots.add(parts[1])
          }
        }
        mergerfsRootsRef.current[selectedId] = roots
        checkPath(roots)
      })
      ?.catch(() => {
        if (!cancelled) mergerfsRootsRef.current[selectedId] = new Set()
      })
    return () => { cancelled = true }
  }, [selectedId, selectedConn?.type])

  // Re-evaluate warning when the user navigates.
  useEffect(() => {
    const roots = mergerfsRootsRef.current[selectedId]
    if (!roots) return
    const p = path.replace(/\/+$/, '') || '/'
    setMergerfsWarning(roots.has(p))
  }, [path, selectedId])

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
    const deletedNames = new Set()
    for (const entry of selectedEntries) {
      if (cancelledRef.current) break
      const entryPath = joinRemote(path, entry.name)
      const isDir = entry.type === 'dir'
      const res = await window.winraid?.remote.delete(selectedId, entryPath, isDir)
      if (res?.ok) { ok++; deletedNames.add(entry.name) }
      else fail++
    }
    if (cancelledRef.current) return
    setOpInFlight(false)
    selection.clearSelection()
    if (cacheMutRef.current === 'update') {
      setEntries((prev) => prev.filter((e) => !deletedNames.has(e.name)))
      remoteFS.update(selectedId, path, (entries) => entries.filter((e) => !deletedNames.has(e.name)))
    } else {
      await fetchDir(path)
    }
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
    const movedNames = new Set()
    for (const entry of selectedEntries) {
      if (cancelledRef.current) break
      const srcPath = joinRemote(path, entry.name)
      const dstPath = joinRemote(dest, entry.name)
      if (srcPath === dstPath) continue
      const res = await window.winraid?.remote.move(selectedId, srcPath, dstPath)
      if (res?.ok) { ok++; movedNames.add(entry.name) }
      else fail++
    }
    if (cancelledRef.current) return
    setOpInFlight(false)
    selection.clearSelection()
    if (cacheMutRef.current === 'update') {
      setEntries((prev) => prev.filter((e) => !movedNames.has(e.name)))
      remoteFS.update(selectedId, path, (entries) => entries.filter((e) => !movedNames.has(e.name)))
    } else {
      await fetchDir(path)
    }
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
    mergerfsWarning,
    handleExternalDragEnter,
    handleExternalDragOver,
    handleExternalDragLeave,
    handleExternalDrop,
    // Sub-hook APIs — spread flat for backward compatibility
    ...selection,
    ...dragDrop,
  }
}
