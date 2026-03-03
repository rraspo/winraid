import styles from './ProgressBar.module.css'

/**
 * @param {{
 *   percent:   number,            // 0–100
 *   status?:   string,            // 'TRANSFERRING' | 'DONE' | 'ERROR'
 *   className?: string,
 * }} props
 */
export default function ProgressBar({ percent = 0, status, className }) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)))

  const fillClass = [
    styles.fill,
    status === 'TRANSFERRING' ? styles.active : null,
    status === 'DONE'         ? styles.done   : null,
    status === 'ERROR'        ? styles.error  : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={[styles.track, className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={fillClass} style={{ width: `${clamped}%` }} />
    </div>
  )
}
