import ConnectionIcon from '../components/ConnectionIcon'
import styles from './ConnectionsView.module.css'

function protocolLabel(connection) {
  return connection.type === 'smb' ? 'SMB' : 'SFTP'
}

function remotePath(connection) {
  return connection.type === 'smb' ? connection.smb?.remotePath : connection.sftp?.remotePath
}

function watcherWord(status) {
  if (status?.watching) return 'Watching'
  if (status?.state === 'paused') return 'Paused'
  return 'Stopped'
}

// Takes over what the pre-redesign sidebar's connection accordion did: see
// every connection, open its browser, edit it, or add a new one. Styled as
// simple cards on the new tokens — the full prototype styling and the
// connection wizard land in a later card.
export default function ConnectionsView({ connections = [], watcherStatuses = {}, onEditConnection, onOpenTab }) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Connections</h2>
        <button type="button" className={styles.addButton} onClick={() => onEditConnection?.(null)}>
          Add connection
        </button>
      </div>

      {connections.length === 0 ? (
        <div className={styles.empty}>No connections yet</div>
      ) : (
        <div className={styles.grid}>
          {connections.map((connection) => (
            <article key={connection.id} className={styles.card} aria-label={connection.name}>
              <div className={styles.cardTop}>
                <ConnectionIcon icon={connection.icon ?? null} size={18} />
                <span className={styles.name}>{connection.name}</span>
                <span className={styles.protocol}>{protocolLabel(connection)}</span>
              </div>
              <div className={styles.paths}>
                <code className={styles.path}>{connection.localFolder}</code>
                <code className={styles.path}>{remotePath(connection)}</code>
              </div>
              <div className={styles.cardBottom}>
                <span className={styles.watcherWord}>{watcherWord(watcherStatuses[connection.id])}</span>
                <div className={styles.actions}>
                  <button type="button" className={styles.actionButton} onClick={() => onOpenTab?.(connection.id, 'browse')}>
                    Browse
                  </button>
                  <button type="button" className={styles.actionButton} onClick={() => onEditConnection?.(connection)}>
                    Edit
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
