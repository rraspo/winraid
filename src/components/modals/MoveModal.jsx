import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import styles from './modals.module.css'

export default function MoveModal({ target, onConfirm, onCancel }) {
  const [dest, setDest] = useState(target.path)
  const trimmed = dest.trim()
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalIconWrap}>
            <TriangleAlert size={20} />
          </span>
          <div>
            <h2 className={styles.modalTitle}>Move / Rename</h2>
            <p className={styles.modalSubtitle}>
              Enter the new full path for <strong>{target.name}</strong>.
            </p>
          </div>
        </div>
        <div className={styles.modalFields}>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Destination path</label>
            <input
              className={styles.fieldInput}
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              spellCheck={false}
              autoFocus
            />
            <p className={styles.fieldHint}>
              Change the directory portion to move, or just the filename to rename.
            </p>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button
            className={styles.modalConfirmAccent}
            onClick={() => onConfirm(target.path, trimmed)}
            disabled={!trimmed || trimmed === target.path}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  )
}
