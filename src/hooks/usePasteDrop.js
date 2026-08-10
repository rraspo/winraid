import { useState, useEffect, useCallback, useRef } from 'react'
import * as remoteFS from '../services/remoteFS'
import { extractDragUrls } from '../utils/dragUrl'

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

// Inbound-file concern for the remote browser: everything that brings bytes in
// from outside the app. Two entry points converge on the same write path —
// clipboard paste (image blob or URL, staged for confirmation in a modal) and
// external drag-and-drop (native files handed to the upload queue, URL payloads
// fetched and written directly).
//
// The mergerfs root guard lives here because it exists solely to block these
// writes: a mergerfs/shfs mount point is a union view, and writing into the
// root itself lands the file on an arbitrary branch. Detection is a
// per-connection read of /proc/mounts, cached, re-evaluated on navigation.
//
// setStatus, setEntries, setHighlightFile, and setOpInFlight are injected by
// the composing hook so this module never opens a second toast, listing, or
// busy-flag path.
export function usePasteDrop({
  selectedId,
  selectedConn,
  path,
  setEntries,
  setOpInFlight,
  setStatus,
  setHighlightFile,
}) {
  const [externalDropActive, setExternalDropActive] = useState(false)
  const [mergerfsWarning,    setMergerfsWarning]    = useState(false)
  const [pendingPaste,       setPendingPaste]       = useState(null)

  const mergerfsRootsRef = useRef({}) // connId → Set<string>
  const pendingPasteRef  = useRef(null)
  const pathRef          = useRef(path)

  pendingPasteRef.current = pendingPaste
  pathRef.current         = path

  // Counter approximates how many nested dragenter/dragleave pairs are in
  // flight. It is deliberately lopsided: enter increments only for acceptable
  // payloads, but leave decrements for any non-internal drag, because
  // dragleave events do not reliably carry dataTransfer type info — filtering
  // them symmetrically would leave the counter stuck (and the drop overlay
  // visible) when a leave arrives without it. The zero-clamp below absorbs
  // the resulting underflow. relatedTarget can be null when crossing
  // pointer-events:none elements (the overlay cards), which would falsely
  // trigger deactivation — the counter approach is immune to that because it
  // counts crossing events, not targets.
  const dragCounterRef = useRef(0)

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

    // Invalidating the captured directory's cache is always correct — the
    // user dropped files there, so its cache must not serve stale data on
    // the next visit. Painting the on-screen listing is a different concern:
    // if the user has navigated away while the fetches were in flight, `dir`
    // is no longer what's on screen, and pushing its listing into view would
    // silently jump the browser back to a folder the user already left.
    // Mirrors handleConfirmPaste's guard below.
    remoteFS.invalidate(selectedId, dir)
    const fresh = await remoteFS.list(selectedId, dir).catch(() => null)
    if (fresh && dir === pathRef.current) setEntries(fresh)

    if (success > 0 && !lastFailMsg) {
      setStatus({ ok: true, msg: `Uploaded ${success} ${success === 1 ? 'file' : 'files'}` })
    } else if (success > 0) {
      setStatus({ ok: false, msg: `Uploaded ${success} with errors: ${lastFailMsg}` })
    } else {
      setStatus({ ok: false, msg: lastFailMsg || 'Failed to upload' })
    }
  }, [selectedId, mergerfsWarning, setEntries, setStatus])

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
  }, [selectedId, mergerfsWarning, setStatus])

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
      // Re-fetch the listing AND push it into the composing hook's local
      // `entries` state so BrowseView re-renders with the new file visible.
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
  }, [selectedId, handleDiscardPaste, setEntries, setHighlightFile, setOpInFlight, setStatus])

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
        if (cancelled) return
        const roots = new Set()
        mergerfsRootsRef.current[selectedId] = roots
        checkPath(roots)
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

  return {
    pendingPaste,
    handlePasteImage, handlePasteUrl, handleConfirmPaste, handleDiscardPaste,
    externalDropActive,
    mergerfsWarning,
    handleExternalDragEnter,
    handleExternalDragOver,
    handleExternalDragLeave,
    handleExternalDrop,
  }
}
