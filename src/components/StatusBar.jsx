import styles from './StatusBar.module.css'

export default function StatusBar({ watcherStatus, activeTransfers }) {
  const { watching, state, file } = watcherStatus

  let label
  if (!watching) {
    label = 'Scanner stopped'
  } else if (state === 'enqueueing') {
    label = file ? `Detecting · ${file}` : 'Detecting file…'
  } else {
    label = 'Scanning for changes'
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
