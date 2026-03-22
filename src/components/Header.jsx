import { useMemo } from 'react'
import { Play, Square } from 'lucide-react'
import Tooltip from './ui/Tooltip'
import styles from './Header.module.css'

export default function Header({ watcherStatus, activeTransfers, activeConnId, onWatcherToggle, connections = [] }) {
  // watcherStatus is a Record<connectionId, { watching, state, file }>
  const entries = Object.values(watcherStatus ?? {})
  const anyWatching = entries.some((s) => s.watching)
  const enqueueing = entries.find((s) => s.state === 'enqueueing')
  const watchingCount = entries.filter((s) => s.watching).length

  // The toggle button acts on the active connection
  const activeStatus   = activeConnId ? (watcherStatus ?? {})[activeConnId] : null
  const activeWatching = activeStatus?.watching ?? false

  // activeTransfers is Map<jobId, connectionId>
  const transferCount = activeTransfers.size

  // Derive unique connection names for active transfers
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

  return (
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
        {activeConnId && (
          <Tooltip tip={activeWatching ? 'Stop scanner for active connection' : 'Start scanner for active connection'} side="bottom">
            <button
              className={[styles.watcherBtn, activeWatching ? styles.watcherBtnStop : styles.watcherBtnStart].join(' ')}
              onClick={() => onWatcherToggle(activeConnId)}
            >
              {activeWatching
                ? <><Square size={11} fill="currentColor" /> Stop</>
                : <><Play  size={11} fill="currentColor" /> Start</>
              }
            </button>
          </Tooltip>
        )}
      </div>
    </header>
  )
}
