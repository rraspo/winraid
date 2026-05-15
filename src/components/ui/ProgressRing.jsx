import styles from './ProgressRing.module.css'

/**
 * SVG arc progress ring. progress is 0–1; the arc fills clockwise.
 * Designed to overlay a media element while it streams in.
 */
export default function ProgressRing({ progress }) {
  const r          = 16
  const stroke     = 3
  const svgSize    = (r + stroke) * 2
  const cx         = svgSize / 2
  const cy         = svgSize / 2
  const circ       = 2 * Math.PI * r
  const dashOffset = circ * (1 - Math.min(progress, 1))

  return (
    <svg
      className={styles.progressRing}
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
