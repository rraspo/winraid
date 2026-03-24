import { AlertCircle } from 'lucide-react'
import styles from './modals.module.css'

export default function DeleteModal({ target, onConfirm, onCancel }) {
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={[styles.modalIconWrap, styles.modalIconDanger].join(' ')}>
            <AlertCircle size={20} />
          </span>
          <div>
            <h2 className={styles.modalTitle}>
              Delete {target.isDir ? 'folder' : 'file'}?
            </h2>
            <p className={styles.modalSubtitle}>
              <strong>{target.name}</strong> will be permanently deleted
              {target.isDir ? ' along with all its contents' : ''}.
              This cannot be undone.
            </p>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button className={styles.modalConfirm} onClick={() => onConfirm(target)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
