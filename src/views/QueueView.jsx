import { useState, useEffect, useRef, useCallback } from 'react'
import { File, Video, Image, FileText, Archive, X, RotateCcw } from 'lucide-react'
import styles from './QueueView.module.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)    return 'just now'
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
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

const STATUS_META = {
  PENDING:     { label: 'Pending',     cls: 'pending' },
  TRANSFERRING:{ label: 'Transferring',cls: 'transferring' },
  DONE:        { label: 'Done',        cls: 'done' },
  ERROR:       { label: 'Error',       cls: 'error' },
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function QueueView() {
  const [jobs, setJobs] = useState([])
  const scrollRef = useRef(null)

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
        case 'cleared':
          setJobs((prev) => prev.filter((j) => j.status !== 'DONE'))
          break
      }
    })

    const unsubProgress = window.winraid?.queue.onProgress(({ jobId, percent }) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, progress: percent / 100, status: 'TRANSFERRING' } : j
        )
      )
    })

    return () => {
      unsubUpdated?.()
      unsubProgress?.()
    }
  }, [refresh])

  const doneCount = jobs.filter((j) => j.status === 'DONE').length
  const pendingCount = jobs.filter((j) => j.status === 'PENDING' || j.status === 'TRANSFERRING').length

  // Sort: active first, then pending, then done, then error
  const sorted = [...jobs].sort((a, b) => {
    const pri = { TRANSFERRING: 0, PENDING: 1, ERROR: 2, DONE: 3 }
    return (pri[a.status] ?? 4) - (pri[b.status] ?? 4)
  })

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Transfer Queue</span>
          {pendingCount > 0 && (
            <span className={styles.countBadge}>{pendingCount} pending</span>
          )}
        </div>
        <div className={styles.headerRight}>
          {doneCount > 0 && (
            <button
              className={styles.clearBtn}
              onClick={() => window.winraid?.queue.clearDone()}
            >
              Clear {doneCount} done
            </button>
          )}
        </div>
      </div>

      {/* Column headers */}
      {jobs.length > 0 && (
        <div className={styles.colHeader}>
          <span className={styles.colFile}>File / Path</span>
          <span className={styles.colStatus}>Status</span>
          <span className={styles.colSize}>Size</span>
          <span className={styles.colTime}>Added</span>
          <span className={styles.colActions} />
        </div>
      )}

      {/* List */}
      <div ref={scrollRef} className={styles.list}>
        {jobs.length === 0 ? (
          <div className={styles.empty}>
            <File size={32} strokeWidth={1} className={styles.emptyIcon} />
            <span>No transfers yet</span>
            <span className={styles.emptyHint}>Add a watch folder in Settings to get started.</span>
          </div>
        ) : (
          sorted.map((job) => <QueueRow key={job.id} job={job} />)
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// QueueRow
// ---------------------------------------------------------------------------
function QueueRow({ job }) {
  const { status, filename, srcPath, progress, createdAt, size, errorMsg } = job
  const dir = srcPath ? srcPath.replace(/[/\\][^/\\]+$/, '') : ''
  const meta = STATUS_META[status] ?? STATUS_META.PENDING
  const isActive = status === 'TRANSFERRING'
  const percent = Math.round((progress ?? 0) * 100)

  return (
    <div className={[styles.row, isActive ? styles.rowActive : ''].join(' ')}>
      {/* File icon */}
      <div className={styles.fileIconWrap}>
        {getFileIcon(filename)}
      </div>

      {/* Name + path */}
      <div className={styles.fileInfo}>
        <span className={styles.filename} title={filename}>{filename}</span>
        {dir && <span className={styles.filepath}>{dir}</span>}
        {errorMsg && <span className={styles.errorMsg}>{errorMsg}</span>}
        {isActive && (
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>

      {/* Status badge */}
      <div className={styles.statusCell}>
        <span className={[styles.statusBadge, styles[`status_${meta.cls}`]].join(' ')}>
          {isActive ? `${percent}%` : meta.label}
        </span>
      </div>

      {/* Size */}
      <div className={styles.sizeCell}>
        {formatSize(size)}
      </div>

      {/* Time */}
      <div className={styles.timeCell}>
        {relativeTime(createdAt)}
      </div>

      {/* Actions */}
      <div className={styles.actionsCell}>
        {status === 'ERROR' && (
          <button
            className={styles.retryBtn}
            onClick={() => window.winraid?.queue.retry(job.id)}
            title="Retry"
          >
            <RotateCcw size={13} />
          </button>
        )}
        {(status === 'PENDING' || status === 'TRANSFERRING') && (
          <button
            className={styles.cancelBtn}
            onClick={() => window.winraid?.queue.cancel?.(job.id)}
            title="Cancel"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
