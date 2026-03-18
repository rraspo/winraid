import { Play, Square } from 'lucide-react'
import styles from './Header.module.css'

export default function Header({ watcherStatus, activeTransfers, onWatcherToggle }) {
  const { watching, state, file } = watcherStatus

  const dotState = !watching ? 'stopped' : state === 'enqueueing' ? 'enqueueing' : 'watching'

  let statusLabel
  if (!watching) {
    statusLabel = 'Scanner stopped'
  } else if (state === 'enqueueing') {
    statusLabel = file ? `Detecting · ${file}` : 'Detecting file…'
  } else {
    statusLabel = 'Watching'
  }

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
          className={[styles.watcherBtn, watching ? styles.watcherBtnStop : styles.watcherBtnStart].join(' ')}
          onClick={onWatcherToggle}
          title={watching ? 'Stop scanner' : 'Start scanner'}
        >
          {watching
            ? <><Square size={11} fill="currentColor" /> Stop</>
            : <><Play  size={11} fill="currentColor" /> Start</>
          }
        </button>
      </div>
    </header>
  )
}
