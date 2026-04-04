import { useState, useEffect, useCallback } from 'react'
import {
  File, Video, Image, FileText, Archive,
  AlertCircle, CheckCircle,
} from 'lucide-react'
import ConnectionIcon from '../components/ConnectionIcon'
import { formatSize } from '../utils/format'
import styles from './DashboardView.module.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


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
export default function DashboardView({ watcherStatus, onNavigate, connections, onOpenTab }) {
  const [jobs, setJobs] = useState([])

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

    const unsubUpdated  = window.winraid?.queue.onUpdated(() => refreshJobs())
    const unsubProgress = window.winraid?.queue.onProgress(({ jobId, percent }) => {
      setJobs((prev) =>
        prev.map((j) => j.id === jobId ? { ...j, progress: percent / 100, status: 'TRANSFERRING' } : j)
      )
    })

    return () => {
      unsubUpdated?.()
      unsubProgress?.()
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

  const [diskUsage, setDiskUsage]     = useState({})
  const [diskLoading, setDiskLoading] = useState(false)

  const refreshDiskUsage = useCallback(async () => {
    const conns = connections ?? []
    if (!conns.length) return
    setDiskLoading(true)
    try {
      const results = await Promise.all(
        conns.map((c) =>
          window.winraid?.remote.diskUsage?.(c.id).catch(() => ({ ok: false, error: 'Request failed' }))
        )
      )
      const map = {}
      conns.forEach((c, i) => { map[c.id] = results[i] })
      setDiskUsage(map)
    } finally {
      setDiskLoading(false)
    }
  }, [connections])

  useEffect(() => { refreshDiskUsage() }, [refreshDiskUsage])

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
                    return (
                      <button
                        key={conn.id}
                        className={styles.connCard}
                        onClick={() => onOpenTab?.(conn.id, 'browse')}
                      >
                        <div className={styles.connCardTop}>
                          <div className={styles.connIconWrap}>
                            <ConnectionIcon icon={conn.icon ?? null} size={18} />
                          </div>
                          <div className={styles.connCardMeta}>
                            <span className={styles.connCardName}>{conn.name}</span>
                            {(watcherStatus ?? {})[conn.id]?.watching
                              ? <span className={styles.connBadgeActive}>Watching</span>
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

            {/* Storage */}
            <div className={styles.contentBlock}>
              <div className={styles.blockHeader}>
                <h3 className={styles.blockTitle}>Storage</h3>
                <button
                  className={styles.viewAllBtn}
                  onClick={refreshDiskUsage}
                  disabled={diskLoading}
                >
                  {diskLoading ? 'Refreshing\u2026' : 'Refresh'}
                </button>
              </div>

              {displayConns.length === 0 ? (
                <div className={styles.emptyRow}>
                  <AlertCircle size={16} className={styles.emptyRowIconWarn} />
                  <span>No connections configured.</span>
                </div>
              ) : (
                <div className={styles.storageList}>
                  {displayConns.map((conn) => {
                    const usage = diskUsage[conn.id]
                    const pct = usage?.ok ? Math.round((usage.used / usage.total) * 100) : 0
                    const isFull = pct >= 90

                    return (
                      <div key={conn.id} className={styles.storageRow}>
                        <div className={styles.storageRowTop}>
                          <div className={styles.storageConnInfo}>
                            <ConnectionIcon icon={conn.icon ?? null} size={13} />
                            <span className={styles.storageConnName}>{conn.name}</span>
                            <span className={styles.connTypeBadge}>{conn.type.toUpperCase()}</span>
                          </div>
                          {usage?.ok ? (
                            <span className={styles.storageStats}>
                              {formatSize(usage.used)} used &middot; {formatSize(usage.free)} free &middot; {formatSize(usage.total)} total
                            </span>
                          ) : usage ? (
                            <span className={styles.storageUnavailable}>Disk usage unavailable</span>
                          ) : (
                            <span className={styles.storageUnavailable}>Loading\u2026</span>
                          )}
                        </div>
                        {usage?.ok && (
                          <div className={styles.progressTrack}>
                            <div
                              className={[styles.progressFill, isFull ? styles.progressFillDanger : ''].filter(Boolean).join(' ')}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
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
  const size     = job.size ? formatSize(job.size) : null

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

