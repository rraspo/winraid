import { useState, useCallback, useEffect } from 'react'
import * as remoteFS from '../services/remoteFS'

function joinRemote(base, name) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

function parentDir(remotePath) {
  const idx = remotePath.lastIndexOf('/')
  return idx > 0 ? remotePath.slice(0, idx) : '/'
}

// Cut/copy/paste for the remote browser. THE CLIPBOARD HOLDS POINTERS, not
// bytes — cut and copy only record { mode, connectionId, paths } in the main
// process (window.winraid.clipboard.*, one buffer shared across every tab
// the same way an OS clipboard would be); the real work happens here, at
// paste time.
//
// Paste iterates the recorded paths one at a time and reports partial
// failure per file rather than aborting the whole batch on the first error —
// the same shape handleBulkDelete/handleBulkMove already use in
// useBrowseMutations. A failed paste (any file failing counts as a failed
// paste) leaves the clipboard intact so the user can retry; only a paste
// where every file succeeded clears it.
export function useClipboard({
  selectedId, path, selectedEntries, cancelledRef, fetchDir, setStatus, setOpInFlight,
}) {
  const [clipboardEntry, setClipboardEntry] = useState(null) // { mode, connectionId, paths } | null
  // Whether the CURRENT connection can run server-side commands at all — a
  // byproduct of the exec probe remote:list/remote:tree already run, cached
  // in the main process. null means "not probed yet" (optimistic: Copy stays
  // enabled by selection alone until proven otherwise).
  const [execCapable, setExecCapable] = useState(null)

  const refreshClipboard = useCallback(async () => {
    const entry = await window.winraid?.clipboard?.get?.()
    setClipboardEntry(entry ?? null)
  }, [])

  useEffect(() => { refreshClipboard() }, [refreshClipboard])

  // Re-checked on every navigation — cheap (reads a cached flag in the main
  // process, no network round trip) and by the time there is anything to
  // select on this connection, at least one directory listing has already
  // run and populated the cache.
  useEffect(() => {
    let cancelled = false
    if (!selectedId) {
      setExecCapable(null)
      return undefined
    }
    const probe = window.winraid?.remote?.execCapable?.(selectedId)
    if (!probe) {
      setExecCapable(null)
      return undefined
    }
    probe.then((res) => {
      if (!cancelled) setExecCapable(res?.capable ?? null)
    }).catch(() => {
      if (!cancelled) setExecCapable(null)
    })
    return () => { cancelled = true }
  }, [selectedId, path])

  const handleCut = useCallback(async () => {
    if (!selectedId || selectedEntries.length === 0) return
    const paths = selectedEntries.map((e) => joinRemote(path, e.name))
    await window.winraid?.clipboard?.set?.('cut', selectedId, paths)
    await refreshClipboard()
  }, [selectedId, path, selectedEntries, refreshClipboard])

  const handleCopy = useCallback(async () => {
    if (!selectedId || selectedEntries.length === 0) return
    const paths = selectedEntries.map((e) => joinRemote(path, e.name))
    await window.winraid?.clipboard?.set?.('copy', selectedId, paths)
    await refreshClipboard()
  }, [selectedId, path, selectedEntries, refreshClipboard])

  const handlePasteClipboard = useCallback(async () => {
    if (!selectedId || !clipboardEntry) return
    const { mode, connectionId: srcConnectionId, paths } = clipboardEntry

    // Cut is a server-side `mv`, copy a server-side `cp` — neither spans two
    // separate SSH connections, so a clipboard recorded on a different
    // connection than the one currently open cannot be pasted here.
    if (srcConnectionId !== selectedId) {
      setStatus({
        ok: false,
        msg: `${mode === 'cut' ? 'Cut' : 'Copy'} and paste only work within the same connection — switch back to the connection you ${mode} from.`,
      })
      return
    }

    setOpInFlight(true)
    let ok = 0, fail = 0, lastError = null
    const srcDirs = new Set()
    try {
      for (const srcPath of paths) {
        if (cancelledRef.current) break
        const name = srcPath.split('/').pop()
        const dstPath = joinRemote(path, name)
        srcDirs.add(parentDir(srcPath))
        if (srcPath === dstPath) {
          fail++
          lastError = `${name} is already in this location`
          continue
        }
        const res = mode === 'cut'
          ? await window.winraid?.remote?.move?.(selectedId, srcPath, dstPath)
          : await window.winraid?.remote?.copy?.(selectedId, srcPath, dstPath)
        if (res?.ok) ok++
        else { fail++; lastError = res?.error || 'Paste failed' }
      }
    } finally {
      setOpInFlight(false)
    }

    if (cancelledRef.current) return

    if (mode === 'cut') {
      for (const dir of srcDirs) remoteFS.invalidate(selectedId, dir)
    }
    remoteFS.invalidate(selectedId, path)
    await fetchDir(path)

    if (fail === 0) {
      await window.winraid?.clipboard?.clear?.()
      await refreshClipboard()
      setStatus({ ok: true, msg: `Pasted ${ok} item${ok !== 1 ? 's' : ''}` })
    } else {
      // Any failure leaves the clipboard exactly as it was, so the whole
      // batch (successes included) can be retried.
      setStatus({ ok: false, msg: `Pasted ${ok}, failed ${fail}${lastError ? ': ' + lastError : ''}` })
    }
  }, [selectedId, path, clipboardEntry, cancelledRef, fetchDir, setStatus, setOpInFlight, refreshClipboard])

  return {
    hasClipboard: !!clipboardEntry,
    clipboardMode: clipboardEntry?.mode ?? null,
    execCapable,
    handleCut, handleCopy, handlePasteClipboard,
  }
}
