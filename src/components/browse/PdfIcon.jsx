import { FileText } from 'lucide-react'
import styles from './PdfIcon.module.css'

// The document glyph with a small "PDF" tag, so a PDF reads as one at a
// glance wherever a file-type icon stands in for a preview.
export default function PdfIcon({ size }) {
  const large = size >= 28
  return (
    <span className={`${styles.icon} ${large ? styles.large : styles.small}`} style={{ width: size, height: size }}>
      <FileText size={size} aria-hidden="true" />
      <span className={styles.badge}>PDF</span>
    </span>
  )
}
