import styles from './Badge.module.css'

const LABELS = {
  PENDING:      'Pending',
  TRANSFERRING: 'Transferring',
  DONE:         'Done',
  ERROR:        'Error',
}

/**
 * @param {{ status: 'PENDING'|'TRANSFERRING'|'DONE'|'ERROR', className?: string }} props
 */
export default function Badge({ status, className }) {
  const variantClass = styles[status] ?? styles.PENDING
  return (
    <span className={[styles.badge, variantClass, className].filter(Boolean).join(' ')}>
      {LABELS[status] ?? status}
    </span>
  )
}
