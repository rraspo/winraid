import { useState, useEffect } from 'react'
import { ChevronUp, Folder } from 'lucide-react'
import Button from './ui/Button'
import Tooltip from './ui/Tooltip'
import styles from './RemotePathBrowser.module.css'

/**
 * Modal SFTP directory picker.
 *
 * Props:
 *   sftpCfg     — { host, port, username, password, keyPath }
 *   initialPath — starting remote path (defaults to '/')
 *   onSelect(path | path[]) — called when the user confirms a folder or folders
 *   onClose()               — called to dismiss the modal
 */
export default function RemotePathBrowser({ sftpCfg, initialPath, onSelect, onClose }) {
  const [currentPath, setCurrentPath] = useState(
    initialPath && initialPath !== '' ? initialPath : '/'
  )
  const [entries, setEntries] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [checked, setChecked] = useState(new Set())

  // Intentional empty deps — only load on mount; navigation calls loadDir directly
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDir(currentPath) }, [])

  async function loadDir(path) {
    setLoading(true); setError(null); setEntries(null)
    try {
      const result = await window.winraid?.ssh.listDir({ ...sftpCfg, remotePath: path })
      if (result?.ok) {
        setEntries(result.entries.filter((e) => e.type === 'dir'))
        setCurrentPath(path)
      } else {
        setError(result?.error ?? 'Failed to list directory')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function navigateUp() {
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    loadDir('/' + parts.join('/'))
  }

  function toggleCheck(path) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function handleConfirm() {
    if (checked.size > 0) {
      onSelect([...checked])
    } else {
      onSelect(currentPath)
    }
    onClose()
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Browse remote path</span>
          <button className={styles.dialogCloseBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.browserNav}>
          <Tooltip tip="Go to parent directory" side="bottom">
            <button className={styles.upBtn} onClick={navigateUp}
              disabled={loading || currentPath === '/'}>
              <ChevronUp size={15} />
            </button>
          </Tooltip>
          <span className={styles.browserPath}>{currentPath}</span>
        </div>
        <div className={styles.dialogBody}>
          {loading ? (
            <span className={styles.muted}>Loading…</span>
          ) : error ? (
            <span className={styles.error}>{error}</span>
          ) : entries?.length === 0 ? (
            <span className={styles.muted}>No subdirectories here.</span>
          ) : (
            entries?.map((e, i) => {
              const fullPath = currentPath === '/' ? `/${e.name}` : `${currentPath}/${e.name}`
              const isChecked = checked.has(fullPath)
              return (
                <div
                  key={i}
                  className={[styles.entryRow, isChecked ? styles.entryRowChecked : ''].join(' ')}
                >
                  <label className={styles.entryCheckLabel}>
                    <input
                      type="checkbox"
                      className={styles.entryCheckbox}
                      checked={isChecked}
                      onChange={() => toggleCheck(fullPath)}
                    />
                  </label>
                  <button
                    className={styles.entryNav}
                    onClick={() => loadDir(fullPath)}
                  >
                    <Folder size={14} className={styles.folderIcon} />
                    {e.name}
                  </button>
                </div>
              )
            })
          )}
        </div>
        <div className={styles.dialogFooter}>
          {checked.size > 0 ? (
            <span className={styles.checkedCount}>{checked.size} selected</span>
          ) : (
            <code className={styles.currentPath}>{currentPath}</code>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleConfirm}>
            {checked.size > 0
              ? `Add ${checked.size} folder${checked.size !== 1 ? 's' : ''}`
              : 'Select this folder'}
          </Button>
        </div>
      </div>
    </div>
  )
}
