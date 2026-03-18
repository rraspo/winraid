import { useState, useEffect, useCallback } from 'react'
import {
  File, Video, Image, FileText, Archive,
  HardDrive, AlertCircle, CheckCircle, Clock,
} from 'lucide-react'
import ConnectionIcon from '../components/ConnectionIcon'
import styles from './DashboardView.module.css'

// Stable monotonic counter for log entry React keys.
// Each new entry gets a unique key that never changes after assignment.
let _logKeyCounter = 0

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)     return 'just now'
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function formatSize(bytes) {
  if (!bytes) return null
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function getFileIcon(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v'].includes(ext))   return <Video size={20} />
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'raw', 'tiff', 'bmp'].includes(ext)) return <Image size={20} />
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'xlsx', 'csv'].includes(ext))   return <FileText size={20} />
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext))             return <Archive size={20} />
  return <File size={20} />
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function DashboardView({ watcherStatus, onNavigate, onEditConnection, connections, activeConnId }) {
  const [jobs,       setJobs]       = useState([])
  const [logEntries, setLogEntries] = useState([])

  // watcherStatus is now a Map<connectionId, { watching, state, file }>
  const watcherEntries = Object.values(watcherStatus ?? {})
  const watching = watcherEntries.some((s) => s.watching)
  const state = watcherEntries.find((s) => s.state === 'enqueueing')?.state ?? (watching ? 'watching' : null)

  const refreshJobs = useCallback(async () => {
    const list = await window.winraid?.queue.list()
    if (list) setJobs(list)
  }, [])

  useEffect(() => {
    refreshJobs()
    window.winraid?.log.tail(12).then((lines) => {
      if (lines?.length) {
        setLogEntries(
          [...lines].reverse().map((e) => ({ ...e, key: `log-${++_logKeyCounter}` }))
        )
      }
    })

    const unsubUpdated  = window.winraid?.queue.onUpdated(() => refreshJobs())
    const unsubProgress = window.winraid?.queue.onProgress(({ jobId, percent }) => {
      setJobs((prev) =>
        prev.map((j) => j.id === jobId ? { ...j, progress: percent / 100, status: 'TRANSFERRING' } : j)
      )
    })
    const unsubLog = window.winraid?.log.onEntry((entry) => {
      setLogEntries((prev) => [{ ...entry, key: `log-${++_logKeyCounter}` }, ...prev].slice(0, 12))
    })

    return () => {
      unsubUpdated?.()
      unsubProgress?.()
      unsubLog?.()
    }
  }, [refreshJobs])

  // Derived stats
  const activeJobs  = jobs.filter((j) => j.status === 'TRANSFERRING')
  const pendingJobs = jobs.filter((j) => j.status === 'PENDING')
  const doneJobs    = jobs.filter((j) => j.status === 'DONE')
  const errorJobs   = jobs.filter((j) => j.status === 'ERROR')

  const visibleQueue = [...activeJobs, ...pendingJobs].slice(0, 4)

  const hasErrors = errorJobs.length > 0

  const displayConns = connections ?? []

  return (
    <div className={styles.container}>
      <div className={styles.scroll}>

        {/* Hero */}
        <section className={styles.hero}>
          <div className={styles.heroLeft}>
            <p className={styles.heroEyebrow}>System Health</p>
            <h2 className={[
              styles.heroTitle,
              hasErrors ? styles.heroTitleError : watching ? styles.heroTitleOk : '',
            ].join(' ')}>
              {hasErrors
                ? `${errorJobs.length} transfer error${errorJobs.length !== 1 ? 's' : ''}`
                : watching
                  ? state === 'enqueueing' ? 'Detecting file…' : 'Scanning for changes'
                  : 'Scanner is stopped'}
            </h2>
            <p className={styles.heroSub}>
              {activeJobs.length > 0
                ? `${activeJobs.length} active transfer${activeJobs.length !== 1 ? 's' : ''} · ${pendingJobs.length} pending`
                : pendingJobs.length > 0
                  ? `${pendingJobs.length} file${pendingJobs.length !== 1 ? 's' : ''} queued`
                  : doneJobs.length > 0
                    ? `${doneJobs.length} transfer${doneJobs.length !== 1 ? 's' : ''} completed`
                    : 'No transfers in queue'}
            </p>
          </div>

          <div className={styles.heroStats}>
            <div className={styles.heroStat}>
              <span className={styles.heroStatValue}>{activeJobs.length + pendingJobs.length}</span>
              <span className={styles.heroStatLabel}>In queue</span>
            </div>
            <div className={styles.heroStat}>
              <span className={[styles.heroStatValue, hasErrors ? styles.heroStatErr : ''].join(' ')}>
                {errorJobs.length}
              </span>
              <span className={styles.heroStatLabel}>Errors</span>
            </div>
          </div>

          <div className={styles.heroDeco} aria-hidden>
            <svg viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="0.5" />
              <circle cx="50" cy="50" r="28" stroke="currentColor" strokeWidth="0.5" />
              <circle cx="50" cy="50" r="16" stroke="currentColor" strokeWidth="0.5" />
            </svg>
          </div>
        </section>

        {/* Bento grid */}
        <div className={styles.grid}>

          {/* Left column */}
          <div className={styles.colMain}>

            {/* Active Transfers */}
            <div className={styles.contentBlock}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Active Transfers</h3>
                {(activeJobs.length + pendingJobs.length) > 0 && (
                  <button className={styles.viewAllBtn} onClick={() => onNavigate('queue')}>
                    View all
                  </button>
                )}
              </div>

              {visibleQueue.length === 0 ? (
                <div className={styles.emptyRow}>
                  <CheckCircle size={16} className={styles.emptyRowIcon} />
                  <span>Queue is empty</span>
                </div>
              ) : (
                <div className={styles.cardGrid}>
                  {visibleQueue.map((job) => (
                    <TransferCard key={job.id} job={job} />
                  ))}
                </div>
              )}
            </div>

            {/* Connections */}
            <div className={styles.contentBlock}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Connections</h3>
              </div>

              {displayConns.length === 0 ? (
                <div className={styles.emptyRow}>
                  <AlertCircle size={16} className={styles.emptyRowIconWarn} />
                  <span>No connection configured.</span>
                </div>
              ) : (
                <div className={styles.cardGrid}>
                  {displayConns.map((conn) => {
                    const host       = conn.type === 'sftp' ? conn.sftp?.host : conn.smb?.host
                    const remotePath = conn.type === 'sftp' ? conn.sftp?.remotePath : conn.smb?.remotePath
                    const isActive   = conn.id === activeConnId
                    return (
                      <button
                        key={conn.id}
                        className={[styles.connCard, isActive ? styles.connCardActive : ''].filter(Boolean).join(' ')}
                        onClick={() => onEditConnection?.(conn)}
                      >
                        <div className={styles.connCardTop}>
                          <div className={styles.connIconWrap}>
                            <ConnectionIcon icon={conn.icon ?? null} size={18} />
                          </div>
                          <div className={styles.connCardMeta}>
                            <span className={styles.connCardName}>{conn.name}</span>
                            {isActive
                              ? <span className={styles.connBadgeActive}>Active</span>
                              : <span className={styles.connBadgeIdle}>Idle</span>
                            }
                          </div>
                          <span className={styles.connTypeBadge}>{conn.type.toUpperCase()}</span>
                        </div>
                        <div className={styles.connCardBottom}>
                          <code className={styles.connHost}>{host}</code>
                          {remotePath && <code className={styles.connPath}>{remotePath}</code>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Right column — Recent Activity */}
          <div className={styles.colSide}>
            <div className={styles.activityPanel}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Recent Activity</h3>
                <button className={styles.viewAllBtn} onClick={() => onNavigate('logs')}>
                  View logs
                </button>
              </div>

              {logEntries.length === 0 ? (
                <div className={styles.emptyRow}>
                  <Clock size={16} className={styles.emptyRowIcon} />
                  <span>No activity yet</span>
                </div>
              ) : (
                <div className={styles.activityList}>
                  {logEntries.map((entry, i) => (
                    <LogEntry key={entry.key ?? i} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TransferCard
// ---------------------------------------------------------------------------
function TransferCard({ job }) {
  const { status, filename, srcPath, progress } = job
  const dir      = srcPath ? srcPath.replace(/[/\\][^/\\]+$/, '') : ''
  const isActive = status === 'TRANSFERRING'
  const percent  = Math.round((progress ?? 0) * 100)
  const size     = formatSize(job.size)

  return (
    <div className={[styles.transferCard, isActive ? styles.transferCardActive : ''].join(' ')}>
      <div className={styles.transferCardTop}>
        <div className={styles.transferIconWrap}>
          {getFileIcon(filename)}
        </div>
        <div className={styles.transferInfo}>
          <span className={styles.transferName} title={filename}>{filename}</span>
          <span className={styles.transferSub}>
            {isActive ? 'Uploading to remote' : status === 'PENDING' ? 'Queued' : (dir || status)}
          </span>
        </div>
      </div>
      <div className={styles.transferCardBottom}>
        <div className={styles.transferMeta}>
          <span>{isActive ? `${percent}% complete` : (size ?? status)}</span>
          {isActive && <span>{percent}%</span>}
        </div>
        <div className={styles.progressTrack}>
          <div
            className={[styles.progressFill, !isActive ? styles.progressFillIdle : ''].filter(Boolean).join(' ')}
            style={{ width: isActive ? `${percent}%` : '0%' }}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LogEntry
// ---------------------------------------------------------------------------
function LogEntry({ entry }) {
  return (
    <div className={[styles.logEntry, styles[`log_${entry.level}`]].join(' ')}>
      <div className={styles.logIconWrap}>
        {entry.level === 'error'
          ? <AlertCircle size={14} />
          : <CheckCircle size={14} />
        }
      </div>
      <div className={styles.logContent}>
        <p className={styles.logMsg}>{entry.message}</p>
        <span className={styles.logTs}>{relativeTime(entry.ts)}</span>
      </div>
    </div>
  )
}
