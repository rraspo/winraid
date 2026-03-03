import { Play, Square } from 'lucide-react'
import styles from './StatusBar.module.css'

export default function StatusBar({ watcherStatus, activeTransfers, onToggle }) {
  const { watching, state, file } = watcherStatus

  const dotState  = !watching ? 'stopped' : state === 'enqueueing' ? 'enqueueing' : 'watching'
  const dotClass  = [styles.dot, styles[dotState]].join(' ')

  let label
  if (!watching) {
    label = 'Watcher stopped'
  } else if (state === 'enqueueing') {
    label = file ? `Enqueueing · ${file}` : 'Enqueueing…'
  } else {
    label = 'Watching'
  }

  return (
    <div className={styles.bar}>
      <button
        className={styles.watcherBtn}
        onClick={onToggle}
        title={watching ? 'Stop watcher' : 'Start watcher'}
      >
        {watching
          ? <Square size={11} fill="currentColor" className={styles.iconStop} />
          : <Play   size={11} fill="currentColor" className={styles.iconPlay} />
        }
      </button>

      <span className={dotClass} />

      <span className={styles.watcherLabel}>{label}</span>

      <div className={styles.spacer} />

      {activeTransfers > 0 && (
        <>
          <div className={styles.divider} />
          <div className={styles.transfers}>
            <span className={styles.spinner} />
            {activeTransfers === 1 ? 'Transferring' : `${activeTransfers} transferring`}
          </div>
        </>
      )}
    </div>
  )
}
