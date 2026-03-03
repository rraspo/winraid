import { useEffect, useState } from 'react'
import { LayoutList, Settings, ScrollText, HardDrive, Download } from 'lucide-react'
import iconSrc from '../../assets/winraid_icon_64x64.png'
import styles from './Sidebar.module.css'

const NAV_TOP = [
  { id: 'browse', label: 'Browse', Icon: HardDrive  },
  { id: 'queue',  label: 'Queue',  Icon: LayoutList },
  { id: 'backup', label: 'Backup', Icon: Download   },
]

const NAV_BOTTOM = [
  { id: 'logs',     label: 'Logs',     Icon: ScrollText },
  { id: 'settings', label: 'Settings', Icon: Settings   },
]

export default function Sidebar({ activeView, onNavigate }) {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.winraid?.getVersion().then(setVersion).catch(() => {})
  }, [])

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <img src={iconSrc} className={styles.logo} alt="WinRaid" />
        <span className={styles.appName}>WinRaid</span>
      </div>

      <nav className={styles.nav}>
        {NAV_TOP.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={[styles.navItem, activeView === id ? styles.active : null]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onNavigate(id)}
          >
            <Icon size={15} strokeWidth={1.75} />
            {label}
          </button>
        ))}

        <div className={styles.navSpacer} />

        {NAV_BOTTOM.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={[styles.navItem, activeView === id ? styles.active : null]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onNavigate(id)}
          >
            <Icon size={15} strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </nav>

      {version && (
        <div className={styles.footer}>
          <span className={styles.version}>v{version}</span>
        </div>
      )}
    </aside>
  )
}
