import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import * as toast from '../../services/toast'
import styles from './Toast.module.css'

const ICONS = { success: CheckCircle, error: AlertCircle, warning: AlertTriangle, info: Info }

export default function Toast({ id, msg, type = 'info', sticky = false, exiting = false }) {
  const Icon = ICONS[type] ?? Info
  return (
    <div
      className={[styles.toast, styles[type] ?? '', exiting ? styles.toastOut : ''].filter(Boolean).join(' ')}
      role="status"
      onMouseEnter={() => { if (!sticky && !exiting) toast.pause(id) }}
      onMouseLeave={() => { if (!sticky && !exiting) toast.resume(id) }}
    >
      <Icon size={14} className={styles.icon} />
      <span className={styles.msg}>{msg}</span>
      <button className={styles.close} aria-label="Dismiss" onClick={() => toast.dismiss(id)}>
        <X size={12} />
      </button>
    </div>
  )
}
