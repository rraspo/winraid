import { useEffect, useState } from 'react'
import { LayoutList, Settings, ScrollText, HardDrive, Download, Plus } from 'lucide-react'
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

// Mock connections — will be replaced by real config state
const MOCK_CONNECTIONS = [
  { id: '1', name: 'Home NAS',       status: 'watching'     },
  { id: '2', name: 'Offsite Backup', status: 'idle'         },
]

export default function Sidebar({ activeView, onNavigate }) {
  const [version, setVersion] = useState('')
  const [activeConn, setActiveConn] = useState(MOCK_CONNECTIONS[0].id)

  useEffect(() => {
    window.winraid?.getVersion().then(setVersion).catch(() => {})
  }, [])

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <img src={iconSrc} className={styles.logo} alt="WinRaid" />
        <span className={styles.appName}>WinRaid</span>
      </div>

      {/* Connection switcher */}
      <div className={styles.connSection}>
        <div className={styles.connHeader}>
          <span className={styles.connLabel}>Connections</span>
          <button className={styles.connAdd} title="Add connection">
            <Plus size={12} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.connList}>
          {MOCK_CONNECTIONS.map((conn) => (
            <button
              key={conn.id}
              className={[
                styles.connItem,
                activeConn === conn.id ? styles.connItemActive : null,
              ].filter(Boolean).join(' ')}
              onClick={() => setActiveConn(conn.id)}
            >
              <span className={[styles.connDot, styles[`connDot_${conn.status}`]].join(' ')} />
              <span className={styles.connName}>{conn.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.connDivider} />

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
