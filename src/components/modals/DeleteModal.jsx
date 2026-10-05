import { useId } from 'react'
import { AlertCircle } from 'lucide-react'
import styles from './modals.module.css'

export default function DeleteModal({ target, trashed = false, onConfirm, onCancel }) {
  const titleId = useId()
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.modalHeader}>
          <span className={[styles.modalIconWrap, styles.modalIconDanger].join(' ')}>
            <AlertCircle size={20} />
          </span>
          <div>
            <h2 id={titleId} className={styles.modalTitle}>
              Delete {target.isDir ? 'folder' : 'file'}?
            </h2>
            <p className={styles.modalSubtitle}>
              {trashed ? (
                <>
                  <strong>{target.name}</strong> will move to the trash
                  {target.isDir ? ' along with all its contents' : ''}.
                  It can be restored from there.
                </>
              ) : (
                <>
                  <strong>{target.name}</strong> will be permanently deleted
                  {target.isDir ? ' along with all its contents' : ''}.
                  This cannot be undone.
                </>
              )}
            </p>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button className={styles.modalConfirm} onClick={() => onConfirm(target)}>
            {trashed ? 'Move to trash' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
