import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSelection } from './useSelection'
import { useDragDrop } from './useDragDrop'
import { useDirFetch } from './useDirFetch'
import { useEntryView } from './useEntryView'
import { useBrowseMutations } from './useBrowseMutations'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'
import { extractDragUrls } from '../utils/dragUrl'

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
  const [externalDropActive, setExternalDropActive] = useState(false)
  const [mergerfsWarning,   setMergerfsWarning]   = useState(false)
  const dirsFirstRef       = useRef(true)
  const sortPersistRef     = useRef('default')
  const mergerfsRootsRef   = useRef({}) // connId → Set<string>
  const cancelledRef       = useRef(false)
  const browseRestoreRef  = useRef(browseRestore)
  const prevPath          = useRef(path)
  const initialPushed     = useRef(false)
  const pathRef           = useRef(path)
  const cacheModeRef = useRef('stale')
  const cacheMutRef  = useRef('update')

  browseRestoreRef.current = browseRestore
  pathRef.current          = path

  // Load browse settings once on mount
  useEffect(() => {
    window.winraid?.config.get('browse').then((browse) => {
      if (browse?.cacheMode)        cacheModeRef.current   = browse.cacheMode
      if (browse?.cacheMutation)    cacheMutRef.current     = browse.cacheMutation
      if (browse?.dirsFirst != null) dirsFirstRef.current   = browse.dirsFirst
      if (browse?.sortPersistence)  sortPersistRef.current  = browse.sortPersistence
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

  // Counter tracks how many nested dragenter/dragleave pairs are in flight.
  // relatedTarget can be null when crossing pointer-events:none elements (the
  // overlay cards), which would falsely trigger deactivation — the counter
  // approach is immune to that because it counts crossing events, not targets.
  const dragCounterRef = useRef(0)

  const isInternalDrag = (e) => e.dataTransfer?.types?.includes('application/x-winraid-internal')

  // An incoming external drag is "acceptable" if it carries native files OR a
  // URL-flavoured payload (image dragged out of a browser). text/plain is
  // intentionally not accepted at this stage — it's too generic (every
  // selected-text drag would falsely qualify); the drop handler will still
  // examine text/plain as a last resort once the user commits.
  function hasAcceptableDragData(e) {
    const types = e.dataTransfer?.types
    if (!types) return false
    return types.includes('Files')
        || types.includes('text/uri-list')
        || types.includes('text/x-moz-url')
  }

  const handleExternalDragEnter = useCallback((e) => {
    if (isInternalDrag(e)) return
    if (!hasAcceptableDragData(e)) return
    dragCounterRef.current += 1
    if (!mergerfsWarning) setExternalDropActive(true)
  }, [mergerfsWarning])

  const handleExternalDragOver = useCallback((e) => {
    if (isInternalDrag(e)) return
    if (!hasAcceptableDragData(e)) return
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

  // Fetch a list of URLs and write each as a file into the current directory.
  // Used when the user drags an image out of a browser — the source provides
  // a URL via text/uri-list (or text/x-moz-url) rather than a native file.
  // Filenames come from Content-Disposition or the URL path, with
  // buildPastedName resolving collisions against the destination listing.
  const handleExternalUrlDrop = useCallback(async (urls) => {
    if (!selectedId || mergerfsWarning || urls.length === 0) return

    const dir = pathRef.current
    const list = await window.winraid?.remote.list(selectedId, dir)
    const existingNames = list?.ok ? new Set((list.entries ?? []).map((e) => e.name)) : new Set()

    let success = 0
    let lastFailMsg = null

    for (const url of urls) {
      setStatus({ ok: true, msg: `Fetching ${url}…` })
      try {
        const res = await window.winraid?.url?.fetch?.(url)
        if (!res?.ok) { lastFailMsg = res?.error || `Fetch failed: ${url}`; continue }
        const name = buildPastedName({ mime: res.mime, suggestedName: res.filename }, existingNames)
        const dest = dir.replace(/\/+$/, '') === '' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`
        const writeRes = await window.winraid?.remote.writeFileBinary(selectedId, dest, res.bytes)
        if (!writeRes?.ok) { lastFailMsg = writeRes?.error || `Write failed: ${name}`; continue }
        await window.winraid?.cache.invalidateFile(selectedId, dest)
        existingNames.add(name)
        success++
      } catch (err) {
        lastFailMsg = err.message || `Failed: ${url}`
      }
    }

    remoteFS.invalidate(selectedId, dir)
    await fetchDir(dir)

    if (success > 0 && !lastFailMsg) {
      setStatus({ ok: true, msg: `Uploaded ${success} ${success === 1 ? 'file' : 'files'}` })
    } else if (success > 0) {
      setStatus({ ok: false, msg: `Uploaded ${success} with errors: ${lastFailMsg}` })
    } else {
      setStatus({ ok: false, msg: lastFailMsg || 'Failed to upload' })
    }
  }, [selectedId, mergerfsWarning, fetchDir])

  const handleExternalDrop = useCallback(async (e) => {
    if (isInternalDrag(e)) return
    e.preventDefault()
    dragCounterRef.current = 0
    setExternalDropActive(false)
    if (!selectedId || mergerfsWarning) return

    // Native files first (drag from Windows Explorer, or browser images
    // that the source kindly cached as a real file).
    const localPaths = Array.from(e.dataTransfer?.files ?? [])
      .map((f) => window.winraid?.getPathForFile?.(f) ?? '')
      .filter(Boolean)
    if (localPaths.length) {
      await window.winraid?.queue.dropUpload(selectedId, pathRef.current, localPaths)
      return
    }

    // No native files — try URL payloads (image dragged out of a browser).
    const urls = extractDragUrls(e.dataTransfer)
    if (urls.length) {
      await handleExternalUrlDrop(urls)
    }
  }, [selectedId, mergerfsWarning, handleExternalUrlDrop])

  // ── Paste image from clipboard ──────────────────────────────────────────────
  // Two-stage: handlePasteImage stages the blob and produces a preview URL,
  // PasteImageModal shows it to the user, then handleConfirmPaste writes it
  // (or handleDiscardPaste cancels).
  const [pendingPaste, setPendingPaste] = useState(null)
  const pendingPasteRef = useRef(null)
  pendingPasteRef.current = pendingPaste

  function extensionForMime(mime) {
    return ({
      'image/png':       '.png',
      'image/jpeg':      '.jpg',
      'image/webp':      '.webp',
      'image/gif':       '.gif',
      'image/bmp':       '.bmp',
      'image/svg+xml':   '.svg',
      'video/mp4':       '.mp4',
      'video/webm':      '.webm',
      'video/quicktime': '.mov',
      'audio/mpeg':      '.mp3',
      'audio/wav':       '.wav',
      'audio/ogg':       '.ogg',
      'application/pdf': '.pdf',
      'application/zip': '.zip',
      'text/plain':      '.txt',
    })[mime] ?? ''
  }

  function buildPastedName(pending, existingNames) {
    // Prefer the suggested filename (from URL fetch) if it has a basename.
    if (pending.suggestedName) {
      const dot  = pending.suggestedName.lastIndexOf('.')
      const stem = dot > 0 ? pending.suggestedName.slice(0, dot) : pending.suggestedName
      const ext  = dot > 0 ? pending.suggestedName.slice(dot)    : (extensionForMime(pending.mime) || '')
      let name = `${stem}${ext}`
      for (let i = 2; existingNames.has(name) && i < 1000; i++) name = `${stem}_${i}${ext}`
      return name
    }
    const ext = extensionForMime(pending.mime) || '.bin'
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const stem = `pasted_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    let name = `${stem}${ext}`
    for (let i = 2; existingNames.has(name) && i < 1000; i++) name = `${stem}_${i}${ext}`
    return name
  }

  const handlePasteImage = useCallback((blob) => {
    if (!selectedId || mergerfsWarning || !blob) return
    // Replace any prior pending paste — revoke the old object URL.
    if (pendingPasteRef.current?.previewUrl) {
      URL.revokeObjectURL(pendingPasteRef.current.previewUrl)
    }
    setPendingPaste({
      blob,
      previewUrl: URL.createObjectURL(blob),
      mime: blob.type || 'image/png',
      size: blob.size,
      dir: pathRef.current,
    })
  }, [selectedId, mergerfsWarning])

  // Fetch a URL via main-process IPC and stage it in pendingPaste, same as
  // handlePasteImage — the modal then previews it (image/video/generic file).
  const handlePasteUrl = useCallback(async (url) => {
    if (!selectedId || mergerfsWarning || !url) return
    setStatus({ ok: true, msg: `Fetching ${url}…` })
    try {
      const res = await window.winraid?.url?.fetch?.(url)
      if (!res?.ok) {
        setStatus({ ok: false, msg: res?.error || 'Fetch failed' })
        return
      }
      const blob = new Blob([res.bytes], { type: res.mime || 'application/octet-stream' })
      if (pendingPasteRef.current?.previewUrl) {
        URL.revokeObjectURL(pendingPasteRef.current.previewUrl)
      }
      setPendingPaste({
        blob,
        previewUrl:    URL.createObjectURL(blob),
        mime:          blob.type || 'application/octet-stream',
        size:          blob.size,
        dir:           pathRef.current,
        suggestedName: res.filename || '',
        sourceUrl:     url,
      })
      setStatus(null)
    } catch (err) {
      setStatus({ ok: false, msg: err.message || 'Fetch failed' })
    }
  }, [selectedId, mergerfsWarning])

  const handleDiscardPaste = useCallback(() => {
    if (pendingPasteRef.current?.previewUrl) {
      URL.revokeObjectURL(pendingPasteRef.current.previewUrl)
    }
    setPendingPaste(null)
  }, [])

  const handleConfirmPaste = useCallback(async () => {
    const pending = pendingPasteRef.current
    if (!pending || !selectedId) return

    const dir = pending.dir
    const list = await window.winraid?.remote.list(selectedId, dir)
    const names = list?.ok ? new Set((list.entries ?? []).map((e) => e.name)) : new Set()
    const name = buildPastedName(pending, names)
    const dest = dir.replace(/\/+$/, '') === '' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`

    setOpInFlight(true)
    setStatus(null)
    try {
      const buf = await pending.blob.arrayBuffer()
      const res = await window.winraid?.remote.writeFileBinary(selectedId, dest, buf)
      if (!res?.ok) throw new Error(res?.error ?? 'Write failed')
      await window.winraid?.cache.invalidateFile(selectedId, dest)
      remoteFS.invalidate(selectedId, dir)
      // Re-fetch the listing AND push it into useBrowse's local `entries`
      // state so BrowseView re-renders with the new file visible.
      const fresh = await remoteFS.list(selectedId, dir).catch(() => null)
      if (fresh && dir === pathRef.current) setEntries(fresh)
      setHighlightFile(name)
      setStatus({ ok: true, msg: `Pasted as ${name}` })
      handleDiscardPaste()
    } catch (err) {
      setStatus({ ok: false, msg: err.message })
    } finally {
      setOpInFlight(false)
    }
  }, [selectedId, handleDiscardPaste])

  // Revoke any pending blob URL when the hook unmounts.
  useEffect(() => () => {
    if (pendingPasteRef.current?.previewUrl) {
      URL.revokeObjectURL(pendingPasteRef.current.previewUrl)
    }
  }, [])

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
    handlePasteImage, handlePasteUrl, handleConfirmPaste, handleDiscardPaste, pendingPaste,
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
