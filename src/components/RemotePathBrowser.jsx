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
 *   onSelect(path) — called when the user confirms a folder
 *   onClose()      — called to dismiss the modal
 */
export default function RemotePathBrowser({ sftpCfg, initialPath, onSelect, onClose }) {
  const [currentPath, setCurrentPath] = useState(
    initialPath && initialPath !== '' ? initialPath : '/'
  )
  const [entries, setEntries] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

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
            entries?.map((e, i) => (
              <button key={i} className={styles.entry}
                onClick={() => loadDir(currentPath === '/' ? `/${e.name}` : `${currentPath}/${e.name}`)}>
                <Folder size={14} className={styles.folderIcon} />
                {e.name}
              </button>
            ))
          )}
        </div>
        <div className={styles.dialogFooter}>
          <code className={styles.currentPath}>{currentPath}</code>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { onSelect(currentPath); onClose() }}>
            Select this folder
          </Button>
        </div>
      </div>
    </div>
  )
}
