import { useState, useEffect } from 'react'
import {
  ArrowUpDown, Search, Filter, PencilLine, MousePointerClick,
  Film, PieChart,
} from 'lucide-react'
import iconSrc from '../../assets/winraid_icon_32x32.png'
import Button from '../components/ui/Button'
import styles from './WhatsNew.module.css'

// Highlights for the current release. Keep entries short and friendly —
// one line each, written for a person, not a changelog.
const HIGHLIGHTS = [
  {
    icon: ArrowUpDown,
    title: 'Sort your files, your way',
    body: 'Sort by name, newest, or oldest from the toolbar. Folders can stay on top, and each folder can remember its own order.',
  },
  {
    icon: Search,
    title: 'Search and jump',
    body: 'Filter the current folder as you type, or just start typing a name to jump straight to it.',
  },
  {
    icon: Filter,
    title: 'Ignored extensions',
    body: 'Tell a connection which file types to skip, alongside the existing allow-list. Both are now properly enforced.',
  },
  {
    icon: PencilLine,
    title: 'Smarter rename',
    body: 'Renaming keeps the extension in its own field, so you will never accidentally drop the “.jpg”.',
  },
  {
    icon: MousePointerClick,
    title: 'Right-click menus',
    body: 'Right-click any file or folder — in list or grid view — to open its actions instantly.',
  },
  {
    icon: Film,
    title: 'Better video thumbnails',
    body: 'Pick the moment used for video previews, in seconds or a percentage, so you skip past black intros.',
  },
  {
    icon: PieChart,
    title: 'Faster size scans',
    body: 'Folder-size scans run in parallel and let you drill deeper on demand, with a clearer breakdown.',
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
