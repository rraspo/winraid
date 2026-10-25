import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  File, Video, Image, FileText, Archive, X, RotateCcw, Clock, AlertTriangle, CheckCircle2,
  Upload, FolderInput, Copy, Pencil, Trash2, FolderPlus, Download, FolderDown, SearchX,
} from 'lucide-react'
import Tooltip from '../components/ui/Tooltip'
import styles from './QueueView.module.css'
import { formatSize } from '../utils/format'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)    return 'just now'
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// The directory shown next to a waiting job's filename.
// For drop-uploads the queue records relPath including any folder
// hierarchy the user dragged in (e.g. "myFolder/sub/photo.jpg"); the
// display must include that prefix so a file dropped inside a folder
// doesn't look like it landed flat in remoteDest. For watcher-driven
// uploads remoteDest isn't set and we fall back to the source dir.
function jobDisplayDir(job) {
  const relDir = job.relPath?.replace(/[/\\][^/\\]+$/, '')
  const relDirPart = relDir && relDir !== job.relPath ? relDir : null
  if (job.remoteDest) {
    return relDirPart
      ? `${job.remoteDest}/${relDirPart}`.replace(/\/+/g, '/')
      : job.remoteDest
  }
  return job.srcPath ? job.srcPath.replace(/[/\\][^/\\]+$/, '') : ''
}

function getFileIcon(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v'].includes(ext))
    return <Video size={18} />
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'raw', 'tiff', 'bmp'].includes(ext))
    return <Image size={18} />
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'xlsx', 'csv'].includes(ext))
    return <FileText size={18} />
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext))
    return <Archive size={18} />
  return <File size={18} />
}

// How many recorded operations the History group reads — the whole feed the
// main process keeps.
const HISTORY_LIMIT = 500

const HISTORY_ICONS = {
  upload:           Upload,
  move:             FolderInput,
  copy:             Copy,
  rename:           Pencil,
  delete:           Trash2,
  mkdir:            FolderPlus,
  download:         Download,
  checkout:         FolderDown,
  'verify-missing': SearchX,
}

function historyIcon(entry) {
  if (entry.level === 'error') return <AlertTriangle size={16} />
  const Icon = HISTORY_ICONS[entry.type] ?? CheckCircle2
  return <Icon size={16} />
}

// Connection name and size, kept as separate leaf elements (not one joined
// string) so a caller can find either piece of text on its own.
function RowMeta({ name, size }) {
  if (!name && !size) return null
  return (
    <span className={styles.rowMeta}>
      {name && <span>{name}</span>}
      {name && size ? ' · ' : null}
      {size && <span>{size}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function QueueView({ connections = [], onBrowsePath, onNavigateLogs }) {
  const [jobs, setJobs] = useState([])
  const [history, setHistory] = useState([])   // activity entries, newest first
  const [activeConnectionId, setActiveConnectionId] = useState(null)
  // Clearing the history cannot be undone, so the button asks once more
  // before it acts — the same two-step the Logs screen's Clear uses.
  const [confirmClear, setConfirmClear] = useState(false)
  const clearTimer = useRef(null)

  useEffect(() => {
    window.winraid?.activity?.tail?.(HISTORY_LIMIT)?.then((entries) => {
      if (entries) setHistory(entries)
    })
    const unsub = window.winraid?.activity?.onEntry?.((entry) => {
      setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT))
    })
    return () => {
      unsub?.()
      clearTimeout(clearTimer.current)
    }
  }, [])

  // Errors have nowhere to go but the log line that explains them; the rest
  // open where the operation left things.
  function handleHistoryClick(entry) {
    if (entry.level === 'error') {
      onNavigateLogs?.({ filename: '', errorAt: entry.ts })
      return
    }
    const nav = entry.nav
    if (nav?.kind === 'reveal') window.winraid?.activity.reveal(nav.localPath)
    else if (nav?.kind === 'remote') onBrowsePath?.(entry.connectionId, nav.path, nav.highlight ?? null)
  }

  // Finished uploads live on as history entries, so clearing the history
  // drops their queue records too; otherwise they would pile up unseen.
  async function handleClearHistory() {
    if (!confirmClear) {
      setConfirmClear(true)
      clearTimer.current = setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    clearTimeout(clearTimer.current)
    setConfirmClear(false)
    setHistory([])
    await Promise.all([window.winraid?.activity.clear(), window.winraid?.queue.clearDone()])
  }

  const connMap = useMemo(() => {
    const m = {}
    for (const c of connections) m[c.id] = c.name || c.id.slice(0, 8)
    return m
  }, [connections])

  function handleRowClick(job) {
    if (job.status === 'ERROR') {
      if (onNavigateLogs) onNavigateLogs({ filename: job.filename, errorAt: job.errorAt ?? Date.now() })
      return
    }
    if (!onBrowsePath || !job.connectionId) return
    const conn = connections.find((c) => c.id === job.connectionId)
    if (!conn) return
    const relDir = job.relPath?.replace(/[/\\][^/\\]+$/, '')
    const relDirPart = relDir && relDir !== job.relPath ? relDir : null
    let dest
    if (job.remoteDest) {
      // Drop-upload: remoteDest is the exact target directory; relPath may have sub-folders
      dest = relDirPart
        ? `${job.remoteDest}/${relDirPart}`.replace(/\/+/g, '/')
        : job.remoteDest
    } else {
      const remotePath = conn.sftp?.remotePath || conn.smb?.remotePath || '/'
      dest = (conn.folderMode !== 'flat' && relDirPart)
        ? `${remotePath}/${relDirPart}`.replace(/\/+/g, '/')
        : remotePath
    }
    onBrowsePath(job.connectionId, dest, job.filename)
  }

  const refresh = useCallback(async () => {
    const list = await window.winraid?.queue.list()
    if (list) setJobs(list)
  }, [])

  useEffect(() => {
    refresh()

    const unsubUpdated = window.winraid?.queue.onUpdated((payload) => {
      switch (payload.type) {
        case 'added':
          refresh()
          break
        case 'updated':
          if (payload.job) {
            setJobs((prev) => {
              const idx = prev.findIndex((j) => j.id === payload.job.id)
              if (idx === -1) return [payload.job, ...prev]
              const next = [...prev]
              next[idx] = payload.job
              return next
            })
          }
          break
        case 'removed':
          setJobs((prev) => prev.filter((j) => j.id !== payload.jobId))
          break
        case 'cleared':
          refresh()
          break
        default:
          // Any payload type this view does not special-case (retry, stats,
          // future additions) converges by refetching instead of drifting.
          refresh()
          break
      }
    })

    const unsubProgress = window.winraid?.queue.onProgress(({ jobId, percent }) => {
      setJobs((prev) =>
        prev.map((j) => {
          if (j.id !== jobId) return j
          // A terminal status (from retry, cancel, or completion) already
          // reflects the store's final word on this job — a late progress
          // tick from the in-flight transfer must not overwrite it.
          if (j.status === 'DONE' || j.status === 'ERROR') return j
          return { ...j, progress: percent / 100, status: 'TRANSFERRING' }
        })
      )
    })

    return () => {
      unsubUpdated?.()
      unsubProgress?.()
    }
  }, [refresh])

  // Filtering by connection hides other connections' jobs from every group;
  // it is only offered when there is more than one connection to tell apart.
  const visibleJobs = useMemo(
    () => (activeConnectionId ? jobs.filter((j) => j.connectionId === activeConnectionId) : jobs),
    [jobs, activeConnectionId]
  )

  const transferring = visibleJobs.filter((j) => j.status === 'TRANSFERRING')
  const waiting       = visibleJobs.filter((j) => j.status === 'PENDING')
  const failed        = visibleJobs.filter((j) => j.status === 'ERROR')
  const visibleHistory = activeConnectionId
    ? history.filter((entry) => entry.connectionId === activeConnectionId)
    : history

  const totalTransferring = jobs.filter((j) => j.status === 'TRANSFERRING').length
  const totalWaiting      = jobs.filter((j) => j.status === 'PENDING').length
  const liveJobs          = jobs.filter((j) => j.status !== 'DONE')
  const subtitle = liveJobs.length === 0
    ? 'Nothing queued'
    : `${totalTransferring} transferring · ${totalWaiting} waiting`

  function connMetaFor(job) {
    return { name: connMap[job.connectionId] ?? null, size: job.size != null ? formatSize(job.size) : null }
  }

  function cancel(id) { window.winraid?.queue.cancel(id) }
  function retry(id) { window.winraid?.queue.retry(id) }
  function remove(id) { window.winraid?.queue.remove(id) }

  if (liveJobs.length === 0 && history.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Activity</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        <div className={styles.empty}>
          <File size={32} strokeWidth={1} className={styles.emptyIcon} />
          <span>No activity yet</span>
          <span className={styles.emptyHint}>Transfers, moves, copies and deletes show up here.</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Activity</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>

      {connections.length > 1 && (
        <div className={styles.chipRow}>
          <button
            type="button"
            className={[styles.chip, activeConnectionId === null ? styles.chipActive : ''].join(' ')}
            aria-pressed={activeConnectionId === null}
            onClick={() => setActiveConnectionId(null)}
          >
            All
          </button>
          {connections.map((conn) => (
            <button
              key={conn.id}
              type="button"
              className={[styles.chip, activeConnectionId === conn.id ? styles.chipActive : ''].join(' ')}
              aria-pressed={activeConnectionId === conn.id}
              onClick={() => setActiveConnectionId(conn.id)}
            >
              {connMap[conn.id]}
            </button>
          ))}
        </div>
      )}

      <div className={styles.groups}>

        {/* Transferring */}
        <section className={styles.group} aria-label="Transferring">
          <h2 className={styles.groupHeading}>Transferring</h2>
          {transferring.length === 0 ? (
            <p className={styles.emptyGroup}>Nothing transferring</p>
          ) : (
            transferring.map((job, idx) => {
              const percent = Math.round((job.progress ?? 0) * 100)
              const meta = connMetaFor(job)
              return (
                <div
                  key={job.id}
                  className={[styles.row, idx > 0 ? styles.rowBordered : ''].join(' ')}
                  onClick={() => handleRowClick(job)}
                >
                  <div className={styles.rowIcon}>{getFileIcon(job.filename)}</div>
                  <div className={styles.rowMain}>
                    <Tooltip tip={job.filename} side="bottom" onlyWhenTruncated>
                      <span className={styles.rowName}>{job.filename}</span>
                    </Tooltip>
                    <RowMeta name={meta.name} size={meta.size} />
                    <div className={styles.progressTrack}>
                      <div className={styles.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
                    </div>
                  </div>
                  <span className={styles.percent}>{percent}%</span>
                  <Tooltip tip="Cancel" side="bottom">
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      aria-label="Cancel"
                      onClick={(e) => { e.stopPropagation(); cancel(job.id) }}
                    >
                      <X size={13} />
                    </button>
                  </Tooltip>
                </div>
              )
            })
          )}
        </section>

        {/* Waiting */}
        <section className={styles.group} aria-label="Waiting">
          <h2 className={styles.groupHeading}>Waiting · {waiting.length}</h2>
          {waiting.map((job, idx) => {
            const dir = jobDisplayDir(job)
            const meta = connMetaFor(job)
            return (
              <div
                key={job.id}
                className={[styles.row, idx > 0 ? styles.rowBordered : ''].join(' ')}
                onClick={() => handleRowClick(job)}
              >
                <div className={styles.rowIcon}><Clock size={16} /></div>
                <div className={styles.rowMain}>
                  <Tooltip tip={job.filename} side="bottom" onlyWhenTruncated>
                    <span className={styles.rowName}>{job.filename}</span>
                  </Tooltip>
                  <RowMeta name={meta.name} size={meta.size} />
                  {dir && (
                    <Tooltip tip={dir} side="bottom" onlyWhenTruncated>
                      <span className={styles.rowDest}>{dir}</span>
                    </Tooltip>
                  )}
                </div>
                <span className={styles.srOnly}>Pending</span>
                <Tooltip tip="Cancel" side="bottom">
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    aria-label="Cancel"
                    onClick={(e) => { e.stopPropagation(); cancel(job.id) }}
                  >
                    <X size={13} />
                  </button>
                </Tooltip>
              </div>
            )
          })}
        </section>

        {/* Failed */}
        <section className={styles.group} aria-label="Failed">
          <div className={styles.groupHeaderRow}>
            <h2 className={styles.groupHeading}>Failed · {failed.length}</h2>
            <div className={styles.groupHeaderActions}>
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => window.winraid?.queue.clearStale()}
              >
                Clear stale
              </button>
            </div>
          </div>
          {failed.map((job, idx) => (
            <div
              key={job.id}
              className={[styles.row, idx > 0 ? styles.rowBordered : ''].join(' ')}
              onClick={() => handleRowClick(job)}
            >
              <div className={styles.rowIcon}><AlertTriangle size={16} /></div>
              <div className={styles.rowMain}>
                <Tooltip tip={job.filename} side="bottom" onlyWhenTruncated>
                  <span className={styles.rowName}>{job.filename}</span>
                </Tooltip>
                <span className={styles.rowError}>{job.errorMsg}</span>
              </div>
              <span className={styles.srOnly}>Error</span>
              <Tooltip tip="Retry" side="bottom">
                <button
                  type="button"
                  className={styles.retryBtn}
                  aria-label="Retry"
                  onClick={(e) => { e.stopPropagation(); retry(job.id) }}
                >
                  <RotateCcw size={13} />
                </button>
              </Tooltip>
              <Tooltip tip="Remove" side="bottom">
                <button
                  type="button"
                  className={styles.removeBtn}
                  aria-label="Remove"
                  onClick={(e) => { e.stopPropagation(); remove(job.id) }}
                >
                  <X size={13} />
                </button>
              </Tooltip>
            </div>
          ))}
        </section>

        {/* History — every recorded operation, newest first */}
        <section className={styles.group} aria-label="History">
          <div className={styles.groupHeaderRow}>
            <h2 className={styles.groupHeading}>History</h2>
            <div className={styles.groupHeaderActions}>
              {history.length > 0 && (
                <button
                  type="button"
                  className={[styles.clearBtn, confirmClear ? styles.clearConfirm : ''].join(' ')}
                  onClick={handleClearHistory}
                >
                  {confirmClear ? 'Clear history?' : 'Clear history'}
                </button>
              )}
            </div>
          </div>
          {visibleHistory.length === 0 ? (
            <p className={styles.emptyGroup}>Nothing recorded yet</p>
          ) : (
            visibleHistory.map((entry, idx) => {
              const isError = entry.level === 'error'
              const connName = connMap[entry.connectionId] ?? null
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={[styles.row, styles.rowButton, idx > 0 ? styles.rowBordered : ''].join(' ')}
                  onClick={() => handleHistoryClick(entry)}
                >
                  <div className={[styles.rowIcon, isError ? styles.rowIconError : ''].join(' ')}>{historyIcon(entry)}</div>
                  <div className={styles.rowMain}>
                    <Tooltip tip={entry.title} side="bottom" onlyWhenTruncated>
                      <span className={styles.rowName} data-testid="history-title">{entry.title}</span>
                    </Tooltip>
                    {entry.detail && (
                      <Tooltip tip={entry.detail} side="bottom" onlyWhenTruncated>
                        <span className={isError ? styles.rowError : styles.rowDest}>{entry.detail}</span>
                      </Tooltip>
                    )}
                  </div>
                  {connName && <span className={styles.rowMeta}>{connName}</span>}
                  <span className={styles.rowTime}>{relativeTime(entry.ts)}</span>
                </button>
              )
            })
          )}
        </section>

      </div>
    </div>
  )
}
