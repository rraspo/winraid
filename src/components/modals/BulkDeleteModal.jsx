import { AlertCircle } from 'lucide-react'
import styles from './modals.module.css'

export default function BulkDeleteModal({ count, names, onConfirm, onCancel }) {
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={[styles.modalIconWrap, styles.modalIconDanger].join(' ')}>
            <AlertCircle size={20} />
          </span>
          <div>
            <h2 className={styles.modalTitle}>
              Delete {count} item{count !== 1 ? 's' : ''}?
            </h2>
            <p className={styles.modalSubtitle}>
              {names.join(', ')} will be permanently deleted. This cannot be undone.
            </p>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button className={styles.modalConfirm} onClick={onConfirm}>
            Delete {count} item{count !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
