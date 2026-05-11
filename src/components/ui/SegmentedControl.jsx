import { useId } from 'react'
import styles from './SegmentedControl.module.css'

export default function SegmentedControl({ label, options, value, onChange, 'aria-label': ariaLabel }) {
  const activeIdx = options.findIndex((o) => o.value === value)
  const active    = activeIdx >= 0 ? options[activeIdx] : null
  const labelId = useId()

  function handleKeyDown(e) {
    if (activeIdx < 0) return
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowDown'  && e.key !== 'ArrowUp') return
    e.preventDefault()
    const dir  = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1
    const next = (activeIdx + dir + options.length) % options.length
    if (options[next].value !== value) onChange(options[next].value)
  }

  return (
    <div
      className={styles.group}
      role="radiogroup"
      aria-labelledby={label ? labelId : undefined}
      aria-label={label ? undefined : ariaLabel}
    >
      {label && <div id={labelId} className={styles.label}>{label}</div>}
      <div className={styles.bar}>
        {options.map((opt) => {
          const isActive = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive || (activeIdx < 0 && options.indexOf(opt) === 0) ? 0 : -1}
              className={isActive ? styles.segmentActive : styles.segment}
              onClick={() => { if (!isActive) onChange(opt.value) }}
              onKeyDown={handleKeyDown}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {active?.desc && <div className={styles.desc}>{active.desc}</div>}
    </div>
  )
}
