import { useState, useEffect, useCallback } from 'react'
import {
  File, Video, Image, FileText, Archive,
  HardDrive, AlertCircle, CheckCircle, Clock,
} from 'lucide-react'
import styles from './DashboardView.module.css'

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

function formatSize(bytes) {
  if (!bytes) return null
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function getFileIcon(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v'].includes(ext))
    return <Video size={20} />
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'raw', 'tiff', 'bmp'].includes(ext))
    return <Image size={20} />
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'xlsx', 'csv'].includes(ext))
    return <FileText size={20} />
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext))
    return <Archive size={20} />
  return <File size={20} />
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function DashboardView({ watcherStatus, onNavigate, onEditConnection, connVersion }) {
  const [jobs, setJobs]           = useState([])
  const [logEntries, setLogEntries] = useState([])
  const [cfg, setCfg]             = useState(null)

  const { watching, state } = watcherStatus ?? {}

  const refreshJobs = useCallback(async () => {
    const list = await window.winraid?.queue.list()
    if (list) setJobs(list)
  }, [])

  useEffect(() => {
    refreshJobs()
    window.winraid?.log.tail(12).then((lines) => {
      if (lines?.length) setLogEntries([...lines].reverse())
    })
    window.winraid?.config.get().then((c) => {
      if (c) setCfg(c)
    })

    function refreshCfg() {
      window.winraid?.config.get().then((c) => { if (c) setCfg(c) })
    }
    window.addEventListener('focus', refreshCfg)
    refreshCfg()

    const unsubUpdated = window.winraid?.queue.onUpdated(() => refreshJobs())
    const unsubProgress = window.winraid?.queue.onProgress(({ jobId, percent }) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, progress: percent / 100, status: 'TRANSFERRING' } : j
        )
      )
    })
    const unsubLog = window.winraid?.log.onEntry((entry) => {
      setLogEntries((prev) => [{ ...entry, key: `${entry.ts}-${Math.random()}` }, ...prev].slice(0, 12))
    })

    return () => {
      window.removeEventListener('focus', refreshCfg)
      unsubUpdated?.()
      unsubProgress?.()
      unsubLog?.()
    }
  }, [refreshJobs])

  useEffect(() => {
    if (connVersion > 0) {
      window.winraid?.config.get().then((c) => { if (c) setCfg(c) })
    }
  }, [connVersion])

  // Derived stats
  const activeJobs  = jobs.filter((j) => j.status === 'TRANSFERRING')
  const pendingJobs = jobs.filter((j) => j.status === 'PENDING')
  const doneJobs    = jobs.filter((j) => j.status === 'DONE')
  const errorJobs   = jobs.filter((j) => j.status === 'ERROR')

  const visibleQueue = [...activeJobs, ...pendingJobs].slice(0, 4)

  const isHealthy = watching && errorJobs.length === 0
  const hasErrors = errorJobs.length > 0

  // Build the same connection list the sidebar uses:
  // named connections array, falling back to flat fields when empty.
  const namedConns   = cfg?.connections ?? []
  const activeConnId = cfg?.activeConnectionId ?? null
  const displayConns = namedConns.length > 0 ? namedConns : (() => {
    const type = cfg?.connectionType ?? 'sftp'
    const host = type === 'sftp' ? cfg?.sftp?.host : cfg?.smb?.host
    if (!host) return []
    return [{ id: '__legacy__', name: host, type, sftp: cfg?.sftp ?? {}, smb: cfg?.smb ?? {} }]
  })()

  return (
    <div className={styles.container}>
      <div className={styles.scroll}>

        {/* Hero — system health */}
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
                  ? state === 'enqueueing' ? 'Detecting file…' : 'Watching for changes'
                  : 'Watcher is stopped'}
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

          {/* Decorative rings */}
          <div className={styles.heroDeco} aria-hidden>
            <svg viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="0.5" />
              <circle cx="50" cy="50" r="28" stroke="currentColor" strokeWidth="0.5" />
              <circle cx="50" cy="50" r="16" stroke="currentColor" strokeWidth="0.5" />
            </svg>
          </div>
        </section>

        {/* Main grid */}
        <div className={styles.grid}>

          {/* Left column */}
          <div className={styles.colMain}>

            {/* Active transfers */}
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <h3 className={styles.sectionTitle}>Active Transfers</h3>
                {(activeJobs.length + pendingJobs.length) > 0 && (
                  <button className={styles.viewAllBtn} onClick={() => onNavigate('queue')}>
                    View all
                  </button>
                )}
              </div>

              {visibleQueue.length === 0 ? (
                <div className={styles.emptyCard}>
                  <CheckCircle size={20} className={styles.emptyCardIcon} />
                  <span>Queue is empty</span>
                </div>
              ) : (
                <div className={styles.transferList}>
                  {visibleQueue.map((job) => (
                    <TransferCard key={job.id} job={job} />
                  ))}
                </div>
              )}
            </div>

            {/* Connections */}
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <h3 className={styles.sectionTitle}>Connections</h3>
              </div>

              {displayConns.length === 0 ? (
                <div className={styles.emptyCard}>
                  <AlertCircle size={20} className={styles.emptyCardIconWarn} />
                  <span>No connection configured.</span>
                </div>
              ) : (
                displayConns.map((conn) => {
                  const host       = conn.type === 'sftp' ? conn.sftp?.host : conn.smb?.host
                  const remotePath = conn.type === 'sftp' ? conn.sftp?.remotePath : conn.smb?.remotePath
                  const isActive   = conn.id === activeConnId || conn.id === '__legacy__'
                  return (
                    <button
                      key={conn.id}
                      className={[styles.connCard, isActive ? styles.connCardActive : ''].join(' ')}
                      onClick={() => onEditConnection?.(conn)}
                    >
                      <div className={styles.connIconWrap}>
                        <HardDrive size={22} />
                      </div>
                      <div className={styles.connInfo}>
                        <div className={styles.connName}>
                          {conn.name}
                          {isActive && <span className={styles.connOnline}>Active</span>}
                        </div>
                        <code className={styles.connHost}>{host}</code>
                        {remotePath && <code className={styles.connPath}>{remotePath}</code>}
                      </div>
                      <span className={styles.connType}>{conn.type.toUpperCase()}</span>
                    </button>
                  )
                })
              )}
            </div>

          </div>

          {/* Right column — recent activity */}
          <div className={styles.colSide}>
            <div className={[styles.section, styles.activitySection].join(' ')}>
              <div className={styles.sectionHead}>
                <h3 className={styles.sectionTitle}>Recent Activity</h3>
                <button className={styles.viewAllBtn} onClick={() => onNavigate('logs')}>
                  View logs
                </button>
              </div>

              {logEntries.length === 0 ? (
                <div className={styles.emptyCard}>
                  <Clock size={18} className={styles.emptyCardIcon} />
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
  const dir = srcPath ? srcPath.replace(/[/\\][^/\\]+$/, '') : ''
  const isActive = status === 'TRANSFERRING'
  const percent = Math.round((progress ?? 0) * 100)
  const size = formatSize(job.size)

  return (
    <div className={[styles.transferCard, isActive ? styles.transferCardActive : ''].join(' ')}>
      <div className={styles.transferIconWrap}>
        {getFileIcon(filename)}
      </div>
      <div className={styles.transferInfo}>
        <div className={styles.transferMeta}>
          <span className={styles.transferName} title={filename}>{filename}</span>
          <span className={styles.transferStatus}>
            {isActive ? `${percent}%` : status === 'PENDING' ? 'Queued' : status}
          </span>
        </div>
        {dir && <span className={styles.transferPath}>{dir}</span>}
        {isActive && (
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${percent}%` }} />
          </div>
        )}
        {!isActive && size && <span className={styles.transferSize}>{size}</span>}
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
