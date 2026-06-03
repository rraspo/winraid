import { useState, useEffect } from 'react'
import {
  ArrowUpDown, Search, Filter, PencilLine, MousePointerClick,
  Film, PieChart, Sparkles,
} from 'lucide-react'
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

  useEffect(() => {
    window.winraid?.getVersion().then(setVersion).catch(() => {})
  }, [])

  function handleClose() {
    window.winraid?.whatsNew?.close()
  }

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <span className={styles.heroIcon}>
          <Sparkles size={22} />
        </span>
        <div>
          <h1 className={styles.title}>What’s new</h1>
          <p className={styles.subtitle}>
            WinRaid {version && <span className={styles.version}>{version}</span>}
          </p>
        </div>
      </div>

      <div className={styles.list}>
        {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
          <div key={title} className={styles.item}>
            <span className={styles.itemIcon}>
              <Icon size={16} />
            </span>
            <div className={styles.itemText}>
              <h2 className={styles.itemTitle}>{title}</h2>
              <p className={styles.itemBody}>{body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <button className={styles.gotItBtn} onClick={handleClose}>
          Got it
        </button>
      </div>
    </div>
  )
}
