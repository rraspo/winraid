import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Pin } from 'lucide-react'
import ConnectionIcon from './ConnectionIcon'
import styles from './ConnectionPicker.module.css'

// Remote root shown under the connection's name — the SFTP path when the
// connection is SFTP, the SMB path when it's SMB, empty when neither is set.
function remoteRootOf(connection) {
  return connection?.sftp?.remotePath ?? connection?.smb?.remotePath ?? ''
}

// The picker every per-connection screen carries: names the connection it is
// showing and, with more than one connection configured, lets the screen
// switch without leaving it. `onSelect(connectionId)` re-targets the caller;
// the picker never navigates on its own.
export default function ConnectionPicker({ connections = [], connectionId, onSelect, defaultConnectionId = null, onSetDefault }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const activeConnection = connections.find((c) => c.id === connectionId) ?? null
  const activeName = activeConnection?.name ?? 'none'
  const activeRoot = remoteRootOf(activeConnection)

  if (connections.length <= 1) {
    return (
      <span className={styles.staticLabel}>
        <ConnectionIcon icon={activeConnection?.icon ?? null} size={13} />
        <span className={styles.staticName}>{activeName}</span>
        {activeRoot && <span className={styles.staticRoot}>{activeRoot}</span>}
      </span>
    )
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`Connection: ${activeName}`}
        onClick={() => setOpen((v) => !v)}
      >
        <ConnectionIcon icon={activeConnection?.icon ?? null} size={13} />
        <span className={styles.triggerName}>{activeName}</span>{' '}
        <span className={styles.triggerRoot}>{activeRoot}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {connections.map((connection) => {
            const isDefault = connection.id === defaultConnectionId
            return (
              // Switching and pinning are separate controls: choosing a
              // connection must not silently change which one these screens
              // open on, and pinning one must not drag you onto it.
              <div key={connection.id} className={styles.itemRow} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={[styles.item, connection.id === connectionId ? styles.itemActive : ''].join(' ')}
                  aria-current={connection.id === connectionId ? 'true' : undefined}
                  onClick={() => {
                    setOpen(false)
                    if (connection.id !== connectionId) onSelect?.(connection.id)
                  }}
                >
                  <ConnectionIcon icon={connection.icon ?? null} size={13} />
                  <span className={styles.itemLabel}>
                    <span className={styles.itemName}>{connection.name}</span>{' '}
                    <span className={styles.itemRoot}>{remoteRootOf(connection)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isDefault}
                  className={[styles.pin, isDefault ? styles.pinOn : ''].join(' ')}
                  aria-label={isDefault
                    ? `Stop ${connection.name} being the default connection`
                    : `Make ${connection.name} the default connection`}
                  onClick={() => onSetDefault?.(isDefault ? null : connection.id)}
                >
                  <Pin size={12} fill={isDefault ? 'currentColor' : 'none'} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
