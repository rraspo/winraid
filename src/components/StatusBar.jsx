import styles from './StatusBar.module.css'

export default function StatusBar({ watcherStatus, activeTransfers }) {
  // watcherStatus is now a Map<connectionId, { watching, state, file }>
  const entries = Object.values(watcherStatus ?? {})
  const anyWatching = entries.some((s) => s.watching)
  const enqueueing = entries.find((s) => s.state === 'enqueueing')
  const watchingCount = entries.filter((s) => s.watching).length

  let label
  if (!anyWatching) {
    label = 'All scanners stopped'
  } else if (enqueueing) {
    label = enqueueing.file ? `Detecting · ${enqueueing.file}` : 'Detecting file…'
  } else {
    label = watchingCount === 1 ? 'Scanning for changes' : `${watchingCount} scanners active`
  }

  return (
    <div className={styles.bar}>
      <span className={styles.label}>{label}</span>
      <div className={styles.spacer} />
      {activeTransfers > 0 && (
        <div className={styles.transfers}>
          <span className={styles.spinner} />
          {activeTransfers === 1 ? 'Transferring' : `${activeTransfers} transferring`}
        </div>
      )}
    </div>
  )
}
