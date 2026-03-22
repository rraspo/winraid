import { useEffect, useState } from 'react'
import { LayoutList, Settings, ScrollText, HardDrive, Download, Sun, Moon, LayoutDashboard, Plus } from 'lucide-react'
import iconSrc from '../../assets/winraid_icon_64x64.png'
import ConnectionIcon from './ConnectionIcon'
import Tooltip from './ui/Tooltip'
import styles from './Sidebar.module.css'

const NAV_TOP = [
  { id: 'dashboard', label: 'Overview', Icon: LayoutDashboard },
  { id: 'browse',    label: 'Browse',   Icon: HardDrive       },
  { id: 'queue',     label: 'Queue',    Icon: LayoutList      },
  { id: 'backup',    label: 'Backup',   Icon: Download        },
]

const NAV_BOTTOM = [
  { id: 'logs',     label: 'Logs',     Icon: ScrollText },
  { id: 'settings', label: 'Settings', Icon: Settings   },
]

export default function Sidebar({ activeView, onNavigate, theme, onThemeToggle, onEditConnection, connections, activeConnId, editingConnId, watcherStatuses }) {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.winraid?.getVersion().then(setVersion).catch(() => {})
  }, [])

  return (
    <>
      <aside className={styles.sidebar}>
        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <img src={iconSrc} className={styles.brandImg} alt="" />
          </div>
          <div>
            <div className={`${styles.brandName} shimmer shimmer-text`}>WinRaid</div>
            <div className={styles.brandSub}>File Synchronization</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          <div className={styles.navGroup}>
            {NAV_TOP.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={[styles.navItem, activeView === id ? styles.active : null]
                  .filter(Boolean).join(' ')}
                onClick={() => onNavigate(id)}
              >
                <Icon size={16} strokeWidth={1.75} className={styles.navIcon} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Connections section */}
          <div className={styles.connSection}>
            <div className={styles.connHeader}>
              <span className={styles.connLabel}>Connections</span>
              <Tooltip tip="Add connection" side="right">
                <button className={styles.addBtn} onClick={() => onEditConnection(null)}>
                  <Plus size={13} strokeWidth={2} />
                </button>
              </Tooltip>
            </div>
            <div className={styles.connList}>
              {connections.length === 0 && (
                <div className={styles.connEmpty}>No connections yet</div>
              )}
              {connections.map((conn) => {
                // connEditing — the form for this connection is currently open
                // connActive  — this is the selected active connection (for watcher)
                // Both can apply simultaneously if the active connection is also being edited.
                const isEditing  = editingConnId === conn.id
                const isActive   = activeConnId === conn.id
                const isWatching = (watcherStatuses ?? {})[conn.id]?.watching ?? false
                return (
                  <button
                    key={conn.id}
                    className={[
                      styles.connItem,
                      isEditing ? styles.connEditing : isActive ? styles.connActive : null,
                    ].filter(Boolean).join(' ')}
                    onClick={() => onEditConnection(conn)}
                  >
                    <span className={styles.connItemIcon}><ConnectionIcon icon={conn.icon ?? null} size={13} /></span>
                    <span className={styles.connItemName}>{conn.name}</span>
                    {isWatching && <Tooltip tip="Scanner active" side="right"><span className={styles.connWatchDot} /></Tooltip>}
                    <span className={styles.connItemType}>{conn.type.toUpperCase()}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className={styles.navSpacer} />

          <div className={styles.navGroup}>
            {NAV_BOTTOM.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={[styles.navItem, activeView === id ? styles.active : null]
                  .filter(Boolean).join(' ')}
                onClick={() => onNavigate(id)}
              >
                <Icon size={16} strokeWidth={1.75} className={styles.navIcon} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className={styles.footer}>
          <Tooltip tip={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} side="right">
            <button
              className={styles.themeToggle}
              onClick={onThemeToggle}
            >
              {theme === 'dark'
                ? <Sun size={13} strokeWidth={1.75} />
                : <Moon size={13} strokeWidth={1.75} />
              }
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
          </Tooltip>
          {version && <span className={styles.version}>v{version}</span>}
        </div>
      </aside>

    </>
  )
}
