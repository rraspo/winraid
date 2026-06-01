import { useState } from 'react'
import { FolderInput } from 'lucide-react'
import RemotePathBrowser from '../RemotePathBrowser'
import styles from './modals.module.css'

function dirOf(fullPath) {
  const idx = fullPath.lastIndexOf('/')
  return idx <= 0 ? '/' : fullPath.slice(0, idx)
}

// Only files with a single, non-leading dot get the stem + extension split
// (e.g. photo.jpg). Dotfiles (.htaccess) and multi-dot names (archive.tar.gz)
// are renamed through a single field so the extension boundary stays clear.
function shouldSplit(name) {
  if (name.startsWith('.')) return false
  const first = name.indexOf('.')
  return first > 0 && first === name.lastIndexOf('.')
}

function splitName(name) {
  const idx = name.lastIndexOf('.')
  return { stem: name.slice(0, idx), ext: name.slice(idx) }
}

export default function MoveModal({ target, sftpCfg, onConfirm, onCancel }) {
  const isDir = target.isDir
  const useSplit = !isDir && shouldSplit(target.name)
  const initial = useSplit ? splitName(target.name) : { stem: target.name, ext: '' }
  const [stem, setStem]       = useState(initial.stem)
  const [ext, setExt]         = useState(initial.ext)
  const [folder, setFolder]   = useState(dirOf(target.path))
  const [browsing, setBrowsing] = useState(false)

  const trimmedName   = `${stem.trim()}${ext.trim()}`
  const trimmedFolder = folder.trim().replace(/\/+$/, '') || '/'
  const assembled     = trimmedFolder === '/' ? `/${trimmedName}` : `${trimmedFolder}/${trimmedName}`
  const unchanged     = assembled === target.path
  const invalid       = !stem.trim() || unchanged

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
              <div className={styles.fieldInputRow}>
                <input
                  className={styles.fieldInput}
                  aria-label="Name"
                  value={stem}
                  onChange={(e) => setStem(e.target.value)}
                  spellCheck={false}
                  autoFocus
                />
                {useSplit && (
                  <input
                    className={styles.extField}
                    aria-label="Extension"
                    value={ext}
                    onChange={(e) => setExt(e.target.value)}
                    spellCheck={false}
                  />
                )}
              </div>
            </div>

            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Folder</label>
              <div className={styles.fieldInputRow}>
                <input
                  className={styles.fieldInput}
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="/"
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
