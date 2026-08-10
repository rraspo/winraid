import { useState, useEffect, useCallback, useRef } from 'react'
import * as remoteFS from '../services/remoteFS'

// Directory-listing concern for the remote browser: the entries/loading/error
// state, the epoch guard that keeps stale responses from clobbering the view,
// the cache-mode fast paths, and the effects that drive re-listing.
//
// setStatus and setHighlightFile are injected by the composing hook so this
// module never opens a second toast or highlight path.
export function useDirFetch({ selectedId, path, connections, cacheModeRef, setStatus, setHighlightFile }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const entriesRef    = useRef([])
  const fetchEpochRef = useRef(0)
  const pathRef       = useRef(path)

  pathRef.current = path

  // Keep entriesRef in sync so mutation callbacks can read latest entries without
  // adding entries to their dependency arrays.
  useEffect(() => { entriesRef.current = entries }, [entries])

  const fetchDir = useCallback(async (targetPath) => {
    if (!selectedId) return
    // Each call claims a fresh epoch; only the latest request may write
    // entries. Without this, a slow listing for a folder the user has already
    // left resolves late and clobbers the current view (breadcrumb stays put,
    // contents silently swap a few seconds later).
    const epoch = ++fetchEpochRef.current
    const isCurrent = () => fetchEpochRef.current === epoch
    const mode = cacheModeRef.current

    if (mode === 'stale') {
      const cached = remoteFS.getSnapshot(selectedId, targetPath)
      if (cached) {
        setEntries(cached)
        setError('')
        setLoading(false)
        remoteFS.invalidate(selectedId, targetPath)
        remoteFS.list(selectedId, targetPath).then((entries) => {
          if (isCurrent()) setEntries(entries)
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
      if (!isCurrent()) return
      setLoading(false)
      setEntries(entries)
    } catch (err) {
      if (!isCurrent()) return
      setLoading(false)
      setError(err.message || 'Failed to list directory')
      setEntries([])
    }
  }, [selectedId, cacheModeRef, setStatus])

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
  }, [selectedId, connections, cacheModeRef])

  // Stable ref so the queue:updated subscription never needs to re-create just
  // because fetchDir changed — avoids missing the DONE event during re-renders.
  const fetchDirRef = useRef(fetchDir)
  fetchDirRef.current = fetchDir
  const refreshTimerRef = useRef(null)

  // Refresh the directory listing when an upload completes — but two ways:
  //  - Skip entirely when the job's known destination folder isn't the one in
  //    view (drop-uploads carry remoteDest; watcher jobs don't, so they refresh).
  //  - Debounce, so a burst of completions collapses into ONE re-list instead of
  //    re-listing the (possibly huge) folder once per file.
  useEffect(() => {
    if (!selectedId) return
    const unsub = window.winraid?.queue.onUpdated((payload) => {
      const { type, job } = payload
      if (type !== 'updated' || job?.status !== 'DONE' || job?.connectionId !== selectedId) return

      const cur = pathRef.current.replace(/\/+$/, '')
      let fileDir = null
      if (job.remoteDest) {
        const relPath   = job.relPath ?? ''
        const lastSlash = relPath.lastIndexOf('/')
        fileDir = lastSlash === -1
          ? job.remoteDest.replace(/\/+$/, '')
          : `${job.remoteDest.replace(/\/+$/, '')}/${relPath.slice(0, lastSlash)}`
      }
      // Known to be a different folder → nothing to refresh here.
      if (fileDir !== null && fileDir !== cur) return
      if (fileDir === cur) setHighlightFile(job.filename)

      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => fetchDirRef.current(pathRef.current), 400)
    })
    return () => { unsub?.(); clearTimeout(refreshTimerRef.current) }
  }, [selectedId, setHighlightFile])

  return { entries, setEntries, entriesRef, loading, error, fetchDir }
}
