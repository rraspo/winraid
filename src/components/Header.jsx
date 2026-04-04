import { useState, useEffect, useMemo } from 'react'
import { Play, Square, History, AlertCircle, CheckCircle, X } from 'lucide-react'
import Tooltip from './ui/Tooltip'
import styles from './Header.module.css'

let _logKeyCounter = 0

function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)     return 'just now'
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Header({ watcherStatus, activeTransfers, queuePaused, onGlobalToggle, connections = [], onNavigate }) {
  const entries      = Object.values(watcherStatus ?? {})
  const anyWatching  = entries.some((s) => s.watching)
  const enqueueing   = entries.find((s) => s.state === 'enqueueing')
  const watchingCount = entries.filter((s) => s.watching).length

  const allStopped = !anyWatching && queuePaused

  const transferCount = activeTransfers.size

  const transferLabel = useMemo(() => {
    if (transferCount === 0) return null
    const connMap = {}
    for (const c of connections) connMap[c.id] = c.name
    const connIds = new Set(activeTransfers.values())
    const names = [...connIds].map((id) => connMap[id]).filter(Boolean)
    if (names.length === 0) return transferCount === 1 ? 'Transferring' : `${transferCount} transferring`
    if (names.length === 1) return `${transferCount === 1 ? 'Transferring' : `${transferCount} transferring`} \u00b7 ${names[0]}`
    return `${transferCount} transferring \u00b7 ${names.join(', ')}`
  }, [transferCount, activeTransfers, connections])

  let statusLabel
  if (!anyWatching) {
    statusLabel = 'All scanners stopped'
  } else if (enqueueing) {
    statusLabel = enqueueing.file ? `Detecting \u00b7 ${enqueueing.file}` : 'Detecting file\u2026'
  } else {
    statusLabel = watchingCount === 1 ? 'Watching' : `${watchingCount} connections watching`
  }

  const dotState = !anyWatching ? 'stopped' : enqueueing ? 'enqueueing' : 'watching'

  const [showActivity, setShowActivity] = useState(false)
  const [logEntries, setLogEntries]     = useState([])

  useEffect(() => {
    window.winraid?.log.tail(12).then((lines) => {
      if (lines?.length) {
        setLogEntries(
          [...lines].reverse().map((e) => ({ ...e, key: `log-${++_logKeyCounter}` }))
        )
      }
    })

    const unsubLog = window.winraid?.log.onEntry((entry) => {
      setLogEntries((prev) => [{ ...entry, key: `log-${++_logKeyCounter}` }, ...prev].slice(0, 12))
    })

    return () => { unsubLog?.() }
  }, [])

  return (
    <>
      <header className={styles.header}>
        <div className={styles.left}>
          <div className={[styles.statusPill, styles[dotState]].join(' ')}>
            <span className={[styles.dot, styles[dotState]].join(' ')} />
            <span className={styles.statusLabel}>{statusLabel}</span>
          </div>
          {transferCount > 0 && (
            <div className={styles.transferPill}>
              <span className={styles.spinner} />
              <span>{transferLabel}</span>
            </div>
          )}
        </div>
        <div className={styles.right}>
          <button
            className={[styles.activityBtn, showActivity ? styles.activityBtnActive : ''].filter(Boolean).join(' ')}
            onClick={() => setShowActivity((v) => !v)}
          >
            <History size={13} />
            Activity
          </button>
          <Tooltip tip={allStopped ? 'Start all scanners and resume queue' : 'Stop all scanners and pause queue'} side="bottom">
            <button
              className={[styles.watcherBtn, allStopped ? styles.watcherBtnStart : styles.watcherBtnStop].join(' ')}
              onClick={onGlobalToggle}
            >
              {allStopped
                ? <><Play  size={11} fill="currentColor" /> Start All</>
                : <><Square size={11} fill="currentColor" /> Stop All</>
              }
            </button>
          </Tooltip>
        </div>
      </header>

      {showActivity && (
        <div className={styles.activityBackdrop} onClick={() => setShowActivity(false)} />
      )}
      <div className={[styles.activityPanel, showActivity ? styles.activityPanelOpen : ''].filter(Boolean).join(' ')}>
        <div className={styles.activityPanelHeader}>
          <span className={styles.activityPanelTitle}>Recent Activity</span>
          <div className={styles.activityPanelActions}>
            <button
              className={styles.activityViewAll}
              onClick={() => { setShowActivity(false); onNavigate?.('logs') }}
            >
              View logs
            </button>
            <button className={styles.activityCloseBtn} onClick={() => setShowActivity(false)}>
              <X size={14} />
            </button>
          </div>
        </div>
        {logEntries.length === 0 ? (
          <div className={styles.activityEmpty}>No activity yet</div>
        ) : (
          <div className={styles.activityList}>
            {logEntries.map((entry, i) => (
              <ActivityEntry key={entry.key ?? i} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function ActivityEntry({ entry }) {
  return (
    <div className={[styles.activityEntry, styles[`level_${entry.level}`]].filter(Boolean).join(' ')}>
      <div className={styles.activityEntryIcon}>
        {entry.level === 'error' ? <AlertCircle size={13} /> : <CheckCircle size={13} />}
      </div>
      <div className={styles.activityEntryContent}>
        <p className={styles.activityEntryMsg}>{entry.message}</p>
        <span className={styles.activityEntryTs}>{relativeTime(entry.ts)}</span>
      </div>
    </div>
  )
}
