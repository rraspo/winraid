import { useState, useEffect, useCallback } from 'react'
import { Pause, Play, CheckCircle } from 'lucide-react'
import ActivityEntry from '../components/ActivityEntry'
import { formatSize } from '../utils/format'
import styles from './DashboardView.module.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function protocolLabel(connection) {
  return connection.type === 'smb' ? 'SMB' : 'SFTP'
}

function remotePathOf(connection) {
  return connection.type === 'smb' ? connection.smb?.remotePath : connection.sftp?.remotePath
}

function watcherWord(status) {
  if (status?.watching) return 'Watching'
  if (status?.state === 'paused') return 'Paused'
  return 'Stopped'
}

function isToday(ts) {
  if (!ts) return false
  const then = new Date(ts)
  const now  = new Date()
  return then.getFullYear() === now.getFullYear()
    && then.getMonth() === now.getMonth()
    && then.getDate() === now.getDate()
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function DashboardView({
  watcherStatus, onNavigate, connections, onOpenTab, onEditConnection,
  queuePaused, onGlobalToggle, activityEntries = [], onActivityNavigate,
}) {
  const [jobs, setJobs] = useState([])
  const [completedTotal, setCompletedTotal] = useState(0)

  const refreshJobs = useCallback(async () => {
    const list = await window.winraid?.queue.list()
    if (list) setJobs(list)
    const stats = await window.winraid?.queue.stats?.()
    if (stats && typeof stats.lifetimeCompleted === 'number') setCompletedTotal(stats.lifetimeCompleted)
  }, [])

  useEffect(() => {
    refreshJobs()

    const unsubUpdated  = window.winraid?.queue.onUpdated(() => refreshJobs())
    const unsubProgress = window.winraid?.queue.onProgress(({ jobId, percent }) => {
      setJobs((prev) =>
        prev.map((j) => {
          if (j.id !== jobId) return j
          // A terminal status already reflects the store's final word on this
          // job — a late progress tick from the in-flight transfer must not
          // overwrite it.
          if (j.status === 'DONE' || j.status === 'ERROR') return j
          return { ...j, progress: percent / 100, status: 'TRANSFERRING' }
        })
      )
    })

    return () => {
      unsubUpdated?.()
      unsubProgress?.()
    }
  }, [refreshJobs])

  const displayConns = connections ?? []

  const [diskUsage, setDiskUsage] = useState({})

  const refreshDiskUsage = useCallback(async () => {
    const conns = connections ?? []
    if (!conns.length) return
    const results = await Promise.all(
      conns.map((c) =>
        window.winraid?.remote.diskUsage?.(c.id).catch(() => ({ ok: false, error: 'Request failed' }))
      )
    )
    const map = {}
    conns.forEach((c, i) => { map[c.id] = results[i] })
    setDiskUsage(map)
  }, [connections])

  useEffect(() => { refreshDiskUsage() }, [refreshDiskUsage])

  // Derived stats
  const activeJobs  = jobs.filter((j) => j.status === 'TRANSFERRING')
  const pendingJobs = jobs.filter((j) => j.status === 'PENDING')
  const errorJobs   = jobs.filter((j) => j.status === 'ERROR')

  const visibleQueue = [...activeJobs, ...pendingJobs].slice(0, 4)

  const watchingCount = displayConns.filter((c) => watcherStatus?.[c.id]?.watching).length
  const pausedWatcherCount = displayConns.length - watchingCount
  const watchersFootnote = displayConns.length > 0 && watchingCount === displayConns.length
    ? 'all folders watched'
    : `${pausedWatcherCount} paused`

  const connectionsLabel = displayConns.length === 1
    ? '1 connection'
    : `${displayConns.length} connections`

  return (
    <div className={styles.container}>
      <div className={styles.scroll}>

        {/* Page header */}
        <header className={styles.pageHeader}>
          <div className={styles.pageHeaderText}>
            <h1 className={styles.title}>Dashboard</h1>
            <p className={styles.subtitle}>Lifetime activity across {connectionsLabel}</p>
          </div>
          {onGlobalToggle && (
            <button type="button" className={styles.pauseButton} onClick={onGlobalToggle}>
              {queuePaused ? <Play size={14} /> : <Pause size={14} />}
              <span>{queuePaused ? 'Resume all' : 'Pause all'}</span>
            </button>
          )}
        </header>

        {/* Stat tiles */}
        <div className={styles.statStrip}>
          <article className={styles.statTile} aria-label="Files synced">
            <span className={styles.statLabel}>Files synced</span>
            <span className={styles.statValue}>{completedTotal.toLocaleString('en-US')}</span>
            <span className={styles.statFootnote}>lifetime</span>
          </article>
          <article className={styles.statTile} aria-label="In queue">
            <span className={styles.statLabel}>In queue</span>
            <span className={styles.statValue}>{activeJobs.length + pendingJobs.length}</span>
            <span className={styles.statFootnote}>waiting or transferring</span>
          </article>
          <article className={styles.statTile} aria-label="Watchers">
            <span className={styles.statLabel}>Watchers</span>
            <span className={styles.statValue}>{watchingCount} of {displayConns.length}</span>
            <span className={styles.statFootnote}>{watchersFootnote}</span>
          </article>
          <article className={styles.statTile} aria-label="Failed">
            <span className={styles.statLabel}>Failed</span>
            <span className={[styles.statValue, styles.statValueErr].join(' ')}>{errorJobs.length}</span>
            <button type="button" className={styles.statLinkFootnote} onClick={() => onNavigate?.('queue')}>
              view in queue
            </button>
          </article>
        </div>

        {/* Active transfers + recent activity */}
        <div className={styles.mainRow}>
          <div className={styles.transfersCard}>
            <h2 className={styles.cardHeading}>Active transfers</h2>
            {visibleQueue.length === 0 ? (
              <div className={styles.emptyRow}>
                <CheckCircle size={16} className={styles.emptyRowIcon} />
                <span>Queue is empty</span>
              </div>
            ) : (
              <div className={styles.transferList}>
                {visibleQueue.map((job) => (
                  <TransferRow key={job.id} job={job} />
                ))}
              </div>
            )}
          </div>

          <section className={styles.activityCard} aria-label="Recent activity">
            <h2 className={styles.cardHeading}>Recent activity</h2>
            {activityEntries.length === 0 ? (
              <div className={styles.emptyRow}>
                <span>No activity yet</span>
              </div>
            ) : (
              <div className={styles.activityList}>
                {activityEntries.map((entry) => (
                  <ActivityEntry
                    key={entry.id}
                    entry={entry}
                    onNavigate={onActivityNavigate}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Connection cards */}
        <div className={styles.connGrid}>
          {displayConns.map((conn) => {
            const usage    = diskUsage[conn.id]
            const status   = watcherStatus?.[conn.id]
            const diskPct  = usage?.ok ? Math.round((usage.used / usage.total) * 100) : 0
            const todayCount = jobs.filter(
              (j) => j.connectionId === conn.id && j.status === 'DONE' && isToday(j.createdAt)
            ).length

            return (
              <article key={conn.id} className={styles.connCard} aria-label={conn.name}>
                <div className={styles.connTop}>
                  <span className={[styles.connDot, status?.watching ? styles.connDotOk : ''].join(' ')} />
                  <span className={styles.connName}>{conn.name}</span>
                  <span className={styles.connProto}>{protocolLabel(conn)}</span>
                </div>
                <code className={styles.connPath}>{conn.localFolder}</code>
                <code className={styles.connPath}>{'→ '}{remotePathOf(conn)}</code>
                <div className={styles.connToday}>
                  <span className={styles.connTodayCount}>{todayCount}</span>
                  <span className={styles.connTodayLabel}>files today &middot; {watcherWord(status)}</span>
                </div>
                <div className={styles.connDisk}>
                  <div className={styles.connDiskHead}>
                    <span>NAS disk</span>
                    <span>
                      {usage?.ok
                        ? `${formatSize(usage.used)} of ${formatSize(usage.total)}`
                        : usage
                          ? 'Disk usage unavailable'
                          : '…'}
                    </span>
                  </div>
                  {usage?.ok && (
                    <div className={styles.progressTrack}>
                      <div className={styles.progressFill} style={{ width: `${diskPct}%` }} />
                    </div>
                  )}
                </div>
                <div className={styles.connActions}>
                  <button type="button" className={styles.connActionButton} onClick={() => onOpenTab?.(conn.id, 'browse')}>
                    Browse
                  </button>
                  <button type="button" className={styles.connActionButton} onClick={() => onEditConnection?.(conn)}>
                    Edit
                  </button>
                  <button type="button" className={styles.connActionButton} onClick={() => onEditConnection?.(conn)}>
                    Verify &amp; clean
                  </button>
                </div>
              </article>
            )
          })}
        </div>

      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TransferRow — a row in the "Active transfers" card
// ---------------------------------------------------------------------------
function TransferRow({ job }) {
  const { status, filename, progress } = job
  const isActive = status === 'TRANSFERRING'
  const percent  = Math.round((progress ?? 0) * 100)
  const size     = job.size ? formatSize(job.size) : null

  return (
    <div className={styles.transferRow}>
      <div className={styles.transferInfo}>
        <span className={styles.transferName}>{filename}</span>
        <span className={styles.transferSub}>
          {isActive ? `${percent}% complete` : status === 'PENDING' ? 'Queued' : (size ?? status)}
        </span>
      </div>
      <div className={styles.progressTrack}>
        <div
          className={[styles.progressFill, !isActive ? styles.progressFillIdle : ''].filter(Boolean).join(' ')}
          style={{ width: `${isActive ? percent : 0}%` }}
        />
      </div>
    </div>
  )
}
