import styles from './ProgressRing.module.css'

/**
 * SVG arc progress ring. progress is 0–1; the arc fills clockwise.
 * Default size is tuned for media overlays; `size` lets callers (status
 * bar, badges, etc.) render a smaller ring inline. `inline` skips the
 * absolute-centering class so the ring participates in normal flex flow.
 */
export default function ProgressRing({ progress, size = 38, inline = false }) {
  const stroke     = size <= 16 ? 2 : 3
  const r          = (size - stroke * 2) / 2
  const svgSize    = size
  const cx         = svgSize / 2
  const cy         = svgSize / 2
  const circ       = 2 * Math.PI * r
  const dashOffset = circ * (1 - Math.min(progress, 1))

  return (
    <svg
      className={inline ? styles.progressRingInline : styles.progressRing}
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      aria-hidden="true"
    >
      <circle
        className={styles.progressRingTrack}
        cx={cx} cy={cy} r={r}
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        className={styles.progressRingArc}
        cx={cx} cy={cy} r={r}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        style={{ transition: 'stroke-dashoffset 0.1s linear' }}
      />
    </svg>
  )
}
