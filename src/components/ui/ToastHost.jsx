import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import * as toast from '../../services/toast'
import Toast from './Toast'
import styles from './Toast.module.css'

// Single global host, mounted once at the app root. A pure view of the store:
// sticky toasts anchor the bottom (nearest the corner); transient toasts stack
// above them, oldest on top so the stack collapses downward as the first-arrived
// expires (FIFO). Toasts mid-exit carry `exiting` and animate out before the
// store drops them.
export default function ToastHost() {
  const toasts = useSyncExternalStore(toast.subscribe, toast.getSnapshot)
  if (typeof document === 'undefined') return null

  const ordered = [...toasts].sort((a, b) => (a.sticky === b.sticky ? 0 : a.sticky ? 1 : -1))

  return createPortal(
    <div className={styles.host}>
      {ordered.map((t) => <Toast key={t.id} {...t} exiting={t.exiting} />)}
    </div>,
    document.body,
  )
}
