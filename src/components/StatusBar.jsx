import { useMemo } from 'react'
import styles from './StatusBar.module.css'

export default function StatusBar({ watcherStatus, activeTransfers, connections = [], onNavigate }) {
  // watcherStatus is now a Map<connectionId, { watching, state, file }>
  const entries = Object.values(watcherStatus ?? {})
  const anyWatching = entries.some((s) => s.watching)
  const enqueueing = entries.find((s) => s.state === 'enqueueing')
  const watchingCount = entries.filter((s) => s.watching).length

  // activeTransfers is Map<jobId, connectionId>
  const transferCount = activeTransfers.size

  const transferLabel = useMemo(() => {
    if (transferCount === 0) return null
    const connMap = {}
    for (const c of connections) connMap[c.id] = c.name
    const connIds = new Set(activeTransfers.values())
    const names = [...connIds].map((id) => connMap[id]).filter(Boolean)
    const prefix = transferCount === 1 ? 'Transferring' : `${transferCount} transferring`
    if (names.length === 0) return prefix
    return `${prefix} \u00b7 ${names.join(', ')}`
  }, [transferCount, activeTransfers, connections])

  let label
  if (!anyWatching) {
    label = 'All scanners stopped'
  } else if (enqueueing) {
    label = enqueueing.file ? `Detecting \u00b7 ${enqueueing.file}` : 'Detecting file\u2026'
  } else {
    label = watchingCount === 1 ? 'Scanning for changes' : `${watchingCount} scanners active`
  }

  return (
    <div className={styles.bar}>
      <span className={styles.label}>{label}</span>
      <div className={styles.spacer} />
      {transferCount > 0 && (
        <button className={styles.transfers} onClick={() => onNavigate?.('queue')}>
          <span className={styles.spinner} />
          {transferLabel}
        </button>
      )}
    </div>
  )
}
