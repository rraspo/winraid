import { useState } from 'react'
import { FolderInput } from 'lucide-react'
import RemotePathBrowser from '../RemotePathBrowser'
import styles from './modals.module.css'

function dirOf(fullPath) {
  const idx = fullPath.lastIndexOf('/')
  return idx <= 0 ? '/' : fullPath.slice(0, idx)
}

export default function MoveModal({ target, sftpCfg, onConfirm, onCancel }) {
  const [name, setName]       = useState(target.name)
  const [folder, setFolder]   = useState(dirOf(target.path))
  const [browsing, setBrowsing] = useState(false)

  const trimmedName   = name.trim()
  const trimmedFolder = folder.trim().replace(/\/+$/, '') || '/'
  const assembled     = trimmedFolder === '/' ? `/${trimmedName}` : `${trimmedFolder}/${trimmedName}`
  const unchanged     = assembled === target.path
  const invalid       = !trimmedName || unchanged

  function handleSelect(pathOrPaths) {
    const picked = Array.isArray(pathOrPaths) ? pathOrPaths[0] : pathOrPaths
    if (picked) setFolder(picked)
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
              <h2 className={styles.modalTitle}>Move / Rename</h2>
              <p className={styles.modalSubtitle}>
                Rename or move <strong>{target.name}</strong>.
              </p>
            </div>
          </div>

          <div className={styles.modalFields}>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Name</label>
              <input
                className={styles.fieldInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                spellCheck={false}
                autoFocus
              />
            </div>

            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Folder</label>
              <div className={styles.fieldInputRow}>
                <input
                  className={styles.fieldInput}
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  spellCheck={false}
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
              onClick={() => onConfirm(target.path, assembled)}
              disabled={invalid}
            >
              Move
            </button>
          </div>
        </div>
      </div>

      {browsing && sftpCfg && (
        <RemotePathBrowser
          sftpCfg={sftpCfg}
          initialPath={folder || '/'}
          onSelect={handleSelect}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  )
}
