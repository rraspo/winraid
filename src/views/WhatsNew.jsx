import { useState, useEffect } from 'react'
import { useAppearance } from '../hooks/useAppearance'
import {
  History, Download, PanelsTopLeft, ArrowDownWideNarrow, FileText, Scissors, Contrast,
} from 'lucide-react'
import whatsNew from '../whatsNew.json'
import iconSrc from '../../assets/winraid_icon_32x32.png'
import Button from '../components/ui/Button'
import styles from './WhatsNew.module.css'

// Highlights live in whatsNew.json so the release script can refuse to tag a
// version they were not written for, and CI can reuse them as release notes.
const ICONS = { History, Download, PanelsTopLeft, ArrowDownWideNarrow, FileText, Scissors, Contrast }
const HIGHLIGHTS = whatsNew.highlights.map((highlight) => ({ ...highlight, icon: ICONS[highlight.icon] }))

export default function WhatsNew() {
  useAppearance()
  const [version, setVersion] = useState('')
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    window.winraid?.getVersion().then(setVersion).catch(() => {})
  }, [])

  useEffect(() => {
    return window.winraid?.update?.onStatus?.((payload) => {
      setUpdateReady(payload?.status === 'ready')
    })
  }, [])

  function handleClose() {
    window.winraid?.whatsNew?.close()
  }

  function handleRestart() {
    window.winraid?.update?.install()
  }

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <img src={iconSrc} alt="" className={styles.heroIcon} />
        <h1 className={styles.title}>What&apos;s new in {version}</h1>
      </div>

      <ul className={styles.list}>
        {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className={styles.item}>
            <span className={styles.itemIcon}>
              <Icon size={16} />
            </span>
            <div className={styles.itemText}>
              <h2 className={styles.itemTitle}>{title}</h2>
              <p className={styles.itemBody}>{body}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className={styles.footer}>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        {updateReady && (
          <Button variant="primary" onClick={handleRestart}>Restart to install</Button>
        )}
      </div>
    </div>
  )
}
