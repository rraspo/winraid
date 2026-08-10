import { useState, useEffect, useCallback, useMemo } from 'react'
import * as remoteFS from '../services/remoteFS'

function joinRemote(base, name) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

// Append a filename to a local-OS directory path, picking the separator
// from whatever the base already uses (Windows folder dialogs return
// backslash paths; if a forward-slash base ever sneaks in we accept it).
function joinLocalPath(base, name) {
  const trimmed = base.replace(/[/\\]+$/, '')
  const sep = trimmed.includes('\\') ? '\\' : '/'
  return `${trimmed}${sep}${name}`
}

function isOutsideRoot(remotePath, cfgRemotePath) {
  if (!cfgRemotePath) return false
  const base = cfgRemotePath.replace(/\/+$/, '')
  return remotePath !== base && !remotePath.startsWith(base + '/')
}

// Write-side concern for the remote browser: every operation that changes the
// remote filesystem (delete, move, create folder, checkout, set sync root) or
// pulls bytes down (download), plus the in-flight flag and the download
// progress readout those operations drive.
//
// The dialog-target state stays with the composing hook — the views bind to it
// directly; only the operations that consume and clear it live here.
//
// setStatus, the dialog setters, and cacheMutRef are injected by the composing
// hook so this module never opens a second toast, settings read, or highlight
// path.
export function useBrowseMutations({
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
}) {
  const [opInFlight,      setOpInFlight]      = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(null)
  // shape: null | { name, filesProcessed, totalFiles, bytesTransferred, totalBytes }

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
  }, [selectedId, selectedConn, connections, localFolder, setConnections, setStatus])

  const handleCheckout = useCallback((remotePath) => {
    if (!selectedId || !localFolder || opInFlight) return
    if (isOutsideRoot(remotePath, cfgRemotePath)) {
      setConfirmTarget(remotePath)
    } else {
      doCheckout(remotePath)
    }
  }, [selectedId, localFolder, opInFlight, cfgRemotePath, doCheckout, setConfirmTarget])

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
  }, [selectedId, opInFlight, setStatus])

  const handleConfirm = useCallback((checkoutPath, targetFolder, newSyncRoot) => {
    setConfirmTarget(null)
    doCheckout(checkoutPath, true, targetFolder, newSyncRoot)
  }, [doCheckout, setConfirmTarget])

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
  }, [selectedId, selectedConn, connections, setConnections, setStatus])

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
  }, [selectedId, path, fetchDir, setEntries, cacheMutRef, setStatus, setDeleteTarget])

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
        const sortFn = (a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return a.name.localeCompare(b.name)
        }
        if (dstDir === path) {
          // Same-dir rename: replace the entry in place in both the cache AND
          // the live entries state. Updating only the cache (as the cross-dir
          // branch does for the destination) would drop it from the current view.
          const renameInPlace = (entries) => {
            const rest = entries.filter((e) => e.name !== srcName)
            if (movedEntry) rest.push({ ...movedEntry, name: dstName })
            return rest.sort(sortFn)
          }
          remoteFS.update(selectedId, path, renameInPlace)
          setEntries((prev) => renameInPlace(prev))
        } else {
          remoteFS.update(selectedId, path, (entries) => entries.filter((e) => e.name !== srcName))
          setEntries((prev) => prev.filter((e) => e.name !== srcName))
          if (movedEntry) {
            remoteFS.update(selectedId, dstDir, (entries) =>
              [...entries, { ...movedEntry, name: dstName }].sort(sortFn))
          }
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
  }, [selectedId, path, fetchDir, entriesRef, setEntries, cacheMutRef, setStatus, setMoveTarget])

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
      remoteFS.invalidate(selectedId, path)
      setStatus({ ok: false, msg: res?.error || 'Failed to create folder' })
      fetchDir(path)
    }
  }, [newFolderName, selectedId, path, fetchDir, setEntries, cacheMutRef, setStatus, setHighlightFile, setNewFolderName])

  const selectedEntries = useMemo(
    () => entries.filter((e) => selection.selected.has(e.name)),
    [entries, selection.selected],
  )

  // ── Bulk operations ────────────────────────────────────────────────────────
  const handleBulkDelete = useCallback(async () => {
    setBulkAction(null)
    setOpInFlight(true)
    setStatus(null)
    const targets = selectedEntries
    selection.clearSelection()
    let ok = 0, fail = 0
    const deletedNames = new Set()
    try {
      for (const entry of targets) {
        if (cancelledRef.current) break
        const entryPath = joinRemote(path, entry.name)
        const isDir = entry.type === 'dir'
        const res = await window.winraid?.remote.delete(selectedId, entryPath, isDir)
        if (res?.ok) { ok++; deletedNames.add(entry.name) }
        else fail++
      }
    } finally {
      setOpInFlight(false)
    }
    if (cancelledRef.current) return
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
  }, [selectedEntries, selectedId, path, fetchDir, selection, setEntries, cacheMutRef, cancelledRef, setStatus, setBulkAction])

  const handleBulkMove = useCallback(async () => {
    const dest = bulkMoveDest.trim()
    if (!dest) return
    setBulkAction(null)
    setBulkMoveDest('')
    setOpInFlight(true)
    setStatus(null)
    const targets = selectedEntries
    selection.clearSelection()
    let ok = 0, fail = 0
    const movedNames = new Set()
    try {
      for (const entry of targets) {
        if (cancelledRef.current) break
        const srcPath = joinRemote(path, entry.name)
        const dstPath = joinRemote(dest, entry.name)
        if (srcPath === dstPath) continue
        const res = await window.winraid?.remote.move(selectedId, srcPath, dstPath)
        if (res?.ok) { ok++; movedNames.add(entry.name) }
        else fail++
      }
    } finally {
      setOpInFlight(false)
    }
    if (cancelledRef.current) return
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
  }, [bulkMoveDest, selectedEntries, selectedId, path, fetchDir, selection, setEntries, cacheMutRef, cancelledRef, setStatus, setBulkAction, setBulkMoveDest])

  const handleBulkCheckout = useCallback(async () => {
    if (!selectedId) return
    const targets = selectedEntries
    if (targets.length === 0) return

    // Folder picker — replaces the old behaviour of silently dumping into
    // the connection's configured localFolder.
    const folder = await window.winraid?.selectDownloadPath('', true)
    if (!folder) return  // user cancelled

    setOpInFlight(true)
    setStatus(null)
    setDownloadProgress(null)
    selection.clearSelection()
    let ok = 0, fail = 0
    let lastError = null
    try {
      for (const entry of targets) {
        if (cancelledRef.current) break
        const remotePath = joinRemote(path, entry.name)
        const isDir = entry.type === 'dir'
        // For directories the backend appends `basename(remotePath)` to the
        // local path itself, so we pass the chosen folder unchanged; for
        // files we have to spell out the destination filename.
        const localPath = isDir ? folder : joinLocalPath(folder, entry.name)
        const res = await window.winraid?.remote.download(selectedId, remotePath, localPath, isDir)
        if (res?.ok) ok++
        else { fail++; if (!lastError) lastError = res?.error }
      }
    } finally {
      setOpInFlight(false)
    }
    if (cancelledRef.current) return
    setDownloadProgress(null)
    if (fail === 0) {
      setStatus({ ok: true, msg: `Downloaded ${ok} item${ok !== 1 ? 's' : ''} to ${folder}` })
    } else {
      setStatus({ ok: false, msg: `Downloaded ${ok}, failed ${fail}${lastError ? ': ' + lastError : ''}` })
    }
  }, [selectedId, selectedEntries, path, selection, cancelledRef, setStatus])

  return {
    opInFlight, setOpInFlight,
    downloadProgress,
    handleCheckout, handleConfirm, handleSetRoot,
    handleDownload,
    handleDelete, handleMove, handleCreateFolder,
    selectedEntries,
    handleBulkDelete, handleBulkMove, handleBulkCheckout,
  }
}
