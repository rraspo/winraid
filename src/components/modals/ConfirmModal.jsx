import { useState } from 'react'
import { TriangleAlert, AlertCircle } from 'lucide-react'
import styles from './modals.module.css'

function remoteParent(p) {
  const parts = p.split('/').filter(Boolean)
  parts.pop()
  return '/' + parts.join('/')
}

export default function ConfirmModal({ remotePath, cfgRemotePath, localFolder, onConfirm, onCancel }) {
  const [checkoutPath, setCheckoutPath] = useState(remotePath)
  const [watchFolder,  setWatchFolder]  = useState(localFolder)
  const newSyncRoot = remoteParent(checkoutPath.trim() || remotePath)

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalIconWrap}><TriangleAlert size={20} /></span>
          <div>
            <h2 className={styles.modalTitle}>Outside sync root</h2>
            <p className={styles.modalSubtitle}>
              This folder is outside your configured remote path. The watch folder will
              be cleared and the sync root will be updated to match.
            </p>
          </div>
        </div>

        <div className={styles.modalFields}>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Current sync root</label>
            <div className={styles.fieldReadonly}>{cfgRemotePath}</div>
            <p className={styles.fieldHint}>Your existing remote path configuration</p>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Checking out</label>
            <input
              className={styles.fieldInput}
              value={checkoutPath}
              onChange={(e) => setCheckoutPath(e.target.value)}
              spellCheck={false}
            />
            <p className={styles.fieldHint}>Remote folder whose structure will be mirrored locally</p>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>New sync root</label>
            <div className={styles.fieldReadonly}>{newSyncRoot}</div>
            <p className={styles.fieldHint}>Replaces your current sync root so relative paths stay aligned</p>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Local watch folder</label>
            <input
              className={styles.fieldInput}
              value={watchFolder}
              onChange={(e) => setWatchFolder(e.target.value)}
              spellCheck={false}
            />
            <p className={styles.fieldHint}>All contents will be deleted before checkout</p>
          </div>
        </div>

        <div className={styles.modalWarning}>
          <AlertCircle size={14} />
          <span>
            Everything inside <strong>{watchFolder || localFolder}</strong> will be
            permanently deleted before the folder structure is created.
          </span>
        </div>

        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button
            className={styles.modalConfirm}
            onClick={() => onConfirm(checkoutPath, watchFolder, newSyncRoot)}
            disabled={!checkoutPath.trim() || !watchFolder.trim()}
          >
            Clear &amp; check out
          </button>
        </div>
      </div>
    </div>
  )
}
