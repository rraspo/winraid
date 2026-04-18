import { useState } from 'react'
import { FolderInput } from 'lucide-react'
import RemotePathBrowser from '../RemotePathBrowser'
import styles from './modals.module.css'

export default function BulkMoveModal({ count, names, dest, onDestChange, onConfirm, onCancel, currentPath, sftpCfg }) {
  const [browsing, setBrowsing] = useState(false)

  function handleSelect(pathOrPaths) {
    const picked = Array.isArray(pathOrPaths) ? pathOrPaths[0] : pathOrPaths
    if (picked) onDestChange(picked)
    setBrowsing(false)
  }

  return (
    <>
      <div className={styles.modalOverlay}>
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <span className={styles.modalIconWrap}>
              <FolderInput size={20} />
            </span>
            <div>
              <h2 className={styles.modalTitle}>
                Move {count} item{count !== 1 ? 's' : ''}
              </h2>
              <p className={styles.modalSubtitle}>
                Move {names.join(', ')} to a new location.
              </p>
            </div>
          </div>

          <div className={styles.modalFields}>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Destination folder</label>
              <div className={styles.fieldInputRow}>
                <input
                  className={styles.fieldInput}
                  value={dest}
                  onChange={(e) => onDestChange(e.target.value)}
                  spellCheck={false}
                  autoFocus
                />
                {sftpCfg && (
                  <button
                    className={styles.fieldBrowseBtn}
                    onClick={() => setBrowsing(true)}
                  >
                    Browse
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className={styles.modalActions}>
            <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
            <button
              className={styles.modalConfirmAccent}
              onClick={onConfirm}
              disabled={!dest.trim() || dest.trim() === currentPath}
            >
              Move
            </button>
          </div>
        </div>
      </div>

      {browsing && sftpCfg && (
        <RemotePathBrowser
          sftpCfg={sftpCfg}
          initialPath={dest || currentPath || '/'}
          onSelect={handleSelect}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  )
}
