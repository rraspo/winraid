import { FolderInput, Trash2, X } from 'lucide-react'
import Tooltip from './ui/Tooltip'
import styles from './BulkSelectionBar.module.css'

// Transient bar for acting on a multi-selection without a permanent toolbar
// slot — shared between the Browse view and the Play wall, the two screens
// that carry a selectable multi-entry list. Purely presentational: callers
// own their own selection and mutation state and pass plain values in, and
// both now drive it with the same { kind, done, total } progress shape, so
// there is no state-shape mismatch to paper over.
//
// One real behavioural difference remains, so it stays a prop rather than
// being forced to agree: Play's bulk loops snapshot the selected files
// before they start, so clearing the selection mid-run is harmless and Play
// leaves Clear enabled throughout. Browse's loop still reads the live
// selection while it runs, so Browse wants Clear disabled along with Move
// and Delete until the run settles — `disableClearDuringMutation` defaults
// to that safer behaviour; Play opts out explicitly.
export default function BulkSelectionBar({
  count, mutationInFlight, onRequestMove, onRequestDelete, onClearSelection,
  disableClearDuringMutation = true,
}) {
  if (count === 0 && !mutationInFlight) return null

  const disabled      = Boolean(mutationInFlight)
  const clearDisabled = disabled && disableClearDuringMutation

  return (
    <div className={styles.bulkBar} role="toolbar" aria-label="Selection">
      {mutationInFlight ? (
        <span className={styles.bulkCount}>
          {mutationInFlight.kind === 'delete' ? 'Deleting' : 'Moving'} {mutationInFlight.done + 1} of {mutationInFlight.total}
        </span>
      ) : (
        <span className={styles.bulkCount}>{count} selected</span>
      )}
      <div className={styles.bulkActions}>
        <Tooltip tip="Move selected" side="top">
          <button
            type="button"
            className={styles.bulkBtn}
            aria-label="Move selected"
            onClick={onRequestMove}
            disabled={disabled}
          >
            <FolderInput size={14} />
          </button>
        </Tooltip>
        <Tooltip tip="Delete selected" side="top">
          <button
            type="button"
            className={[styles.bulkBtn, styles.bulkBtnDanger].join(' ')}
            aria-label="Delete selected"
            onClick={onRequestDelete}
            disabled={disabled}
          >
            <Trash2 size={14} />
          </button>
        </Tooltip>
        <Tooltip tip="Clear selection" side="top">
          <button
            type="button"
            className={styles.bulkBtn}
            aria-label="Clear selection"
            onClick={onClearSelection}
            disabled={clearDisabled}
          >
            <X size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
