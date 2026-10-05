import { useState, useEffect } from 'react'
import {
  Palette, PanelsTopLeft, ClipboardPaste, Info, Trash2, Pin, Eye, Clapperboard,
} from 'lucide-react'
import iconSrc from '../../assets/winraid_icon_32x32.png'
import Button from '../components/ui/Button'
import styles from './WhatsNew.module.css'

// Highlights for the current release. Keep entries short and friendly —
// one line each, written for a person, not a changelog.
const HIGHLIGHTS = [
  {
    icon: Palette,
    title: 'A whole new look',
    body: 'Every screen is redesigned around a new title bar, nav rail and status bar. Pick your accent color in Settings.',
  },
  {
    icon: PanelsTopLeft,
    title: 'Tabs that behave',
    body: 'Open folders and files in tabs, drag them into any order, and step back and forward through each one with the mouse side buttons.',
  },
  {
    icon: ClipboardPaste,
    title: 'Cut, copy and paste',
    body: 'Move and copy files between folders on your NAS from the new two-row command bar, right where you would expect them.',
  },
  {
    icon: Info,
    title: 'Properties at a glance',
    body: 'See size, dates and attributes for anything you select, a Kind column in the list, and video length and resolution right on the thumbnail.',
  },
  {
    icon: Trash2,
    title: 'Deletes you can undo',
    body: 'Local deletes go to the Recycle Bin, and each connection can keep its own trash on the NAS instead of deleting for good.',
  },
  {
    icon: Pin,
    title: 'A default connection',
    body: 'Pin the connection Browse, Play and the other screens open on, and keep every favorite folder in one list.',
  },
  {
    icon: Eye,
    title: 'Watchers remember',
    body: 'A watcher you stopped stays stopped after a restart, and a connection that cannot be watched now tells you why.',
  },
  {
    icon: Clapperboard,
    title: 'Play wall and Quick Look',
    body: 'Select tiles on the play wall to move or delete them, and open any of them straight into Quick Look.',
  },
]

export default function WhatsNew() {
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
