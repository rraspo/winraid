import { Play, Square } from 'lucide-react'
import styles from './Header.module.css'

export default function Header({ watcherStatus, activeTransfers, onWatcherToggle }) {
  // watcherStatus is now a Map<connectionId, { watching, state, file }>
  const entries = Object.values(watcherStatus ?? {})
  const anyWatching = entries.some((s) => s.watching)
  const enqueueing = entries.find((s) => s.state === 'enqueueing')
  const watchingCount = entries.filter((s) => s.watching).length

  let statusLabel
  if (!anyWatching) {
    statusLabel = 'All scanners stopped'
  } else if (enqueueing) {
    statusLabel = enqueueing.file ? `Detecting · ${enqueueing.file}` : 'Detecting file…'
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

        {activeTransfers > 0 && (
          <div className={styles.transferPill}>
            <span className={styles.spinner} />
            <span>{activeTransfers === 1 ? 'Transferring' : `${activeTransfers} transferring`}</span>
          </div>
        )}
      </div>

      <div className={styles.right}>
        <button
          className={[styles.watcherBtn, anyWatching ? styles.watcherBtnStop : styles.watcherBtnStart].join(' ')}
          onClick={() => onWatcherToggle()}
          title={anyWatching ? 'Stop scanner' : 'Start scanner'}
        >
          {anyWatching
            ? <><Square size={11} fill="currentColor" /> Stop</>
            : <><Play  size={11} fill="currentColor" /> Start</>
          }
        </button>
      </div>
    </header>
  )
}
