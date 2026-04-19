import { Folder, FolderPlus, X as XIcon } from 'lucide-react'
import styles from './NewFolderPrompt.module.css'

export default function NewFolderPrompt({ variant, name, onChange, onCreate, onCancel }) {
  function onKeyDown(e) {
    if (e.key === 'Enter') onCreate()
    if (e.key === 'Escape') onCancel()
  }

  if (variant === 'grid') {
    return (
      <div className={styles.newFolderCard}>
        <div className={styles.newFolderCardIcon}>
          <FolderPlus size={32} className={styles.iconDir} />
        </div>
        <div className={styles.newFolderCardBody}>
          <input
            className={styles.newFolderInput}
            value={name}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Folder name"
            autoFocus
            spellCheck={false}
          />
          <div className={styles.newFolderCardActions}>
            <button className={styles.newFolderConfirm} onClick={onCreate} disabled={!name.trim()}>
              Create
            </button>
            <button className={styles.newFolderCancel} onClick={onCancel}>
              <XIcon size={12} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.newFolderRow}>
      <Folder size={14} className={styles.iconDir} />
      <input
        className={styles.newFolderInput}
        value={name}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Folder name"
        autoFocus
        spellCheck={false}
      />
      <button className={styles.newFolderConfirm} onClick={onCreate} disabled={!name.trim()}>
        Create
      </button>
      <button className={styles.newFolderCancel} onClick={onCancel}>
        <XIcon size={13} />
      </button>
    </div>
  )
}
