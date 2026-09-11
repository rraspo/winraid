import { Plus } from 'lucide-react'
import ConnectionIcon from '../components/ConnectionIcon'
import styles from './ConnectionsView.module.css'

const FOLDER_MODE_LABELS = {
  flat:         'Flat',
  mirror:       'Mirror',
  mirror_clean: 'Mirror + clean',
}

function protocolLabel(connection) {
  return connection.type === 'smb' ? 'SMB' : 'SFTP'
}

// The host line under the connection name: the SSH host for SFTP, the UNC
// share for SMB (SMB connections carry no separate "host" field on screen).
function hostLine(connection) {
  return connection.type === 'smb' ? connection.smb?.share : connection.sftp?.host
}

function remotePath(connection) {
  return connection.type === 'smb' ? connection.smb?.remotePath : connection.sftp?.remotePath
}

function watcherWord(status) {
  if (status?.watching) return 'Watching'
  if (status?.state === 'paused') return 'Paused'
  return 'Stopped'
}

function statusDotClass(word) {
  if (word === 'Watching') return styles.dotWatching
  if (word === 'Paused') return styles.dotPaused
  return styles.dotStopped
}

// The rule pills summarizing this connection's transfer behavior — mirrors
// the fields on the Rules step of the editor.
function ruleTags(connection) {
  const tags = [connection.operation === 'move' ? 'Move' : 'Copy']
  tags.push(FOLDER_MODE_LABELS[connection.folderMode] ?? FOLDER_MODE_LABELS.flat)
  if (connection.renameDuplicates) tags.push('Rename duplicates')
  if (connection.extensions?.length) tags.push(connection.extensions.join(', '))
  return tags
}

// The Connections screen — every watched folder at a glance: its protocol,
// host, watch/remote paths, rule summary and per-card actions. Verify opens
// the same editor as Edit, where Verify & Clean lives (see ConnectionView).
export default function ConnectionsView({ connections = [], watcherStatuses = {}, onEditConnection, onOpenTab, onStartWatching, onStopWatching }) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Connections</h1>
          <p className={styles.subtitle}>Each watched folder pushes to its own destination with its own rules</p>
        </div>
        <button type="button" className={styles.addButton} onClick={() => onEditConnection?.(null)}>
          <Plus size={14} strokeWidth={2.2} />
          New connection
        </button>
      </div>

      {connections.length === 0 ? (
        <div className={styles.empty}>No connections yet</div>
      ) : (
        <div className={styles.grid}>
          {connections.map((connection) => {
            const word = watcherWord(watcherStatuses[connection.id])
            return (
              <article key={connection.id} className={styles.card} aria-label={connection.name}>
                <div className={styles.cardTop}>
                  <div className={styles.iconTile}>
                    <ConnectionIcon icon={connection.icon ?? null} size={18} />
                  </div>
                  <div className={styles.identity}>
                    <div className={styles.nameRow}>
                      <span className={styles.name}>{connection.name}</span>
                      <span className={styles.protocolPill}>{protocolLabel(connection)}</span>
                    </div>
                    <div className={styles.hostLine}>{hostLine(connection)}</div>
                  </div>
                  <div className={styles.statusGroup}>
                    <span className={[styles.statusDot, statusDotClass(word)].join(' ')} />
                    <span className={styles.statusWord}>{word}</span>
                  </div>
                </div>

                <div className={styles.pathGrid}>
                  <div className={styles.pathBlock}>
                    <div className={styles.pathLabel}>Watch folder</div>
                    <code className={styles.pathValue}>{connection.localFolder}</code>
                  </div>
                  <div className={styles.pathBlock}>
                    <div className={styles.pathLabel}>Remote path</div>
                    <code className={styles.pathValue}>{remotePath(connection)}</code>
                  </div>
                </div>

                <div className={styles.tagRow}>
                  {ruleTags(connection).map((tag) => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                  <div className={styles.actions}>
                    {!connection.localFolder ? (
                      <span className={styles.noWatchFolder}>No watch folder</span>
                    ) : word === 'Watching' ? (
                      <button
                        type="button"
                        className={styles.actionButton}
                        aria-label={`Stop watching ${connection.name}`}
                        onClick={() => onStopWatching?.(connection.id)}
                      >
                        Stop watching
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.actionButton}
                        aria-label={`Start watching ${connection.name}`}
                        onClick={() => onStartWatching?.(connection.id)}
                      >
                        Start watching
                      </button>
                    )}
                    <button type="button" className={styles.actionButton} onClick={() => onOpenTab?.(connection.id, 'browse')}>
                      Browse files
                    </button>
                    <button type="button" className={styles.actionButton} onClick={() => onEditConnection?.(connection)}>
                      Verify
                    </button>
                    <button type="button" className={styles.actionButton} onClick={() => onEditConnection?.(connection)}>
                      Edit
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
