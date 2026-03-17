import { useEffect, useState, useCallback } from 'react'
import { LayoutList, Settings, ScrollText, HardDrive, Download, Sun, Moon, LayoutDashboard, Plus, Server } from 'lucide-react'
import iconSrc from '../../assets/winraid_icon_64x64.png'
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

export default function Sidebar({ activeView, onNavigate, theme, onThemeToggle, onEditConnection, connVersion }) {
  const [version,      setVersion]      = useState('')
  const [connections,  setConnections]  = useState([])
  const [activeConnId, setActiveConnId] = useState(null)

  const loadConnections = useCallback(async () => {
    const cfg   = await window.winraid?.config.get() ?? {}
    const conns = cfg.connections ?? []

    // If no named connections exist but a legacy flat config is set, synthesize
    // a display entry so both sidebar and dashboard show the same connection.
    if (conns.length === 0 && (cfg.sftp?.host || cfg.smb?.host)) {
      const type = cfg.connectionType ?? 'sftp'
      setConnections([{
        id:   '__legacy__',
        name: type === 'sftp' ? cfg.sftp?.host : cfg.smb?.host,
        type,
        sftp: cfg.sftp ?? {},
        smb:  cfg.smb  ?? {},
      }])
      setActiveConnId('__legacy__')
    } else {
      setConnections(conns)
      setActiveConnId(cfg.activeConnectionId ?? null)
    }
  }, [])

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  // Refresh when a connection is saved via the App-level modal
  useEffect(() => {
    if (connVersion > 0) loadConnections()
  }, [connVersion, loadConnections])

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
            <div className={styles.brandName}>WinRaid</div>
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
              <button className={styles.addBtn} onClick={() => onEditConnection(null)} title="Add connection">
                <Plus size={13} strokeWidth={2} />
              </button>
            </div>
            <div className={styles.connList}>
              {connections.length === 0 && (
                <div className={styles.connEmpty}>No connections yet</div>
              )}
              {connections.map((conn) => (
                <button
                  key={conn.id}
                  className={[styles.connItem, activeConnId === conn.id ? styles.connActive : null]
                    .filter(Boolean).join(' ')}
                  onClick={() => onEditConnection(conn)}
                >
                  <Server size={13} strokeWidth={1.75} className={styles.connItemIcon} />
                  <span className={styles.connItemName}>{conn.name}</span>
                  <span className={styles.connItemType}>{conn.type.toUpperCase()}</span>
                </button>
              ))}
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
          <button
            className={styles.themeToggle}
            onClick={onThemeToggle}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark'
              ? <Sun size={13} strokeWidth={1.75} />
              : <Moon size={13} strokeWidth={1.75} />
            }
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          {version && <span className={styles.version}>v{version}</span>}
        </div>
      </aside>

    </>
  )
}
