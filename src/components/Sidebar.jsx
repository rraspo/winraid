import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LayoutList, Settings, ScrollText, LayoutDashboard, Plus, ChevronRight, Folder, Download, Pencil, Sun, Moon, BarChart2, Star, X } from 'lucide-react'
import { favName } from '../utils/favorites'
import iconSrc from '../../assets/winraid_icon_64x64.png'
import ConnectionIcon from './ConnectionIcon'
import Tooltip from './ui/Tooltip'
import { readAccordionMode, readExpandedConns, writeExpandedConns, initialExpanded } from '../utils/accordionMode'
import styles from './Sidebar.module.css'

const NAV_TOP = [
  { id: 'dashboard', label: 'Overview', Icon: LayoutDashboard },
  { id: 'queue',     label: 'Queue',    Icon: LayoutList      },
]

const NAV_BOTTOM = [
  { id: 'logs',     label: 'Logs',     Icon: ScrollText },
  { id: 'settings', label: 'Settings', Icon: Settings   },
]

export default function Sidebar({
  activeView, onNavigate, theme, onThemeToggle,
  onEditConnection, connections, openTabs, activeTabId,
  onOpenTab = () => {}, editingConnId, watcherStatuses,
  favorites = {}, onNavigateFavorite = () => {}, onRemoveFavorite = () => {},
}) {
  const [version,       setVersion]       = useState('')
  // openTabs is accepted for future use (e.g., auto-expand accordion when a tab is open)
  // activeTabId drives the current sub-item highlight via isTabActive()
  const [expandedConns, setExpandedConns] = useState(new Set())
  const initializedRef = useRef(false)
  // Favorites hover flyout: which connection's panel is open + where to anchor
  // it. position:fixed so it escapes the sidebar's overflow:hidden ancestors.
  const [favFlyout, setFavFlyout] = useState(null)  // null | { connId, top, left }
  const favCloseTimer = useRef(null)

  function openFavFlyout(connId, e) {
    clearTimeout(favCloseTimer.current)
    const r = e.currentTarget.getBoundingClientRect()
    setFavFlyout({ connId, top: r.top, left: r.right + 2 })
  }
  function scheduleCloseFavFlyout() {
    clearTimeout(favCloseTimer.current)
    favCloseTimer.current = setTimeout(() => setFavFlyout(null), 120)
  }
  function cancelCloseFavFlyout() {
    clearTimeout(favCloseTimer.current)
  }

  // Resolve initial accordion state from the configured mode (expanded /
  // collapsed / remember). Runs once when connections first load (async).
  useEffect(() => {
    if (connections.length === 0 || initializedRef.current) return
    initializedRef.current = true
    const mode = readAccordionMode()
    setExpandedConns(initialExpanded(mode, connections.map((c) => c.id), readExpandedConns()))
  }, [connections])

  useEffect(() => {
    window.winraid?.getVersion().then(setVersion).catch(() => {})
  }, [])

  function toggleAccordion(connId) {
    setExpandedConns((prev) => {
      const next = new Set(prev)
      if (next.has(connId)) next.delete(connId)
      else next.add(connId)
      // In "remember" mode, persist each connection's open/closed state.
      if (readAccordionMode() === 'remember') writeExpandedConns(next)
      return next
    })
  }

  function isTabActive(connId, type) {
    return activeTabId === `${connId}:${type}`
  }

  return (
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

      <nav className={styles.nav}>
        {/* Global nav */}
        <div className={styles.navGroup}>
          {NAV_TOP.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={[styles.navItem, activeView === id ? styles.active : null].filter(Boolean).join(' ')}
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

          <div className={styles.connScroll}>
            {connections.length === 0 && (
              <div className={styles.connEmpty}>No connections yet</div>
            )}
            {connections.map((conn) => {
              const isOpen     = expandedConns.has(conn.id)
              const isEditing  = editingConnId === conn.id
              const isWatching = (watcherStatuses ?? {})[conn.id]?.watching ?? false

              return (
                <div
                  key={conn.id}
                  className={[
                    styles.accordion,
                    isOpen    ? styles.accordionOpen    : '',
                    isEditing ? styles.accordionEditing : '',
                  ].filter(Boolean).join(' ')}
                >
                  <button
                    className={styles.accordionHeader}
                    onClick={() => toggleAccordion(conn.id)}
                  >
                    <ConnectionIcon icon={conn.icon ?? null} size={13} />
                    <span className={styles.accordionName}>{conn.name}</span>
                    {isWatching && (
                      <Tooltip tip="Scanner active" side="right">
                        <span className={styles.connWatchDot} />
                      </Tooltip>
                    )}
                    <span className={styles.accordionType}>{conn.type.toUpperCase()}</span>
                    <ChevronRight size={12} strokeWidth={2} className={styles.accordionChevron} />
                  </button>

                  {isOpen && (
                    <div className={styles.accordionBody}>
                      <button
                        data-testid={`sub-browse-${conn.id}`}
                        className={[styles.subItem, styles.subItemBrowse, isTabActive(conn.id, 'browse') ? styles.subItemActive : ''].filter(Boolean).join(' ')}
                        onClick={() => onOpenTab(conn.id, 'browse')}
                        onMouseEnter={(e) => openFavFlyout(conn.id, e)}
                        onMouseLeave={scheduleCloseFavFlyout}
                      >
                        <Folder size={12} strokeWidth={1.75} />
                        Browse
                        <ChevronRight size={11} strokeWidth={2} className={styles.favChevron} />
                      </button>
                      <button
                        data-testid={`sub-backup-${conn.id}`}
                        className={[styles.subItem, isTabActive(conn.id, 'backup') ? styles.subItemActive : ''].filter(Boolean).join(' ')}
                        onClick={() => onOpenTab(conn.id, 'backup')}
                      >
                        <Download size={12} strokeWidth={1.75} />
                        Backup
                      </button>
                      <button
                        data-testid={`sub-size-${conn.id}`}
                        className={[styles.subItem, isTabActive(conn.id, 'size') ? styles.subItemActive : ''].filter(Boolean).join(' ')}
                        onClick={() => onOpenTab(conn.id, 'size')}
                      >
                        <BarChart2 size={12} strokeWidth={1.75} />
                        Size
                      </button>
                      <button
                        data-testid={`sub-edit-${conn.id}`}
                        className={[styles.subItem, isEditing ? styles.subItemActive : ''].filter(Boolean).join(' ')}
                        onClick={() => onEditConnection(conn)}
                      >
                        <Pencil size={12} strokeWidth={1.75} />
                        Edit Connection
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className={styles.navGroup}>
          {NAV_BOTTOM.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={[styles.navItem, activeView === id ? styles.active : null].filter(Boolean).join(' ')}
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
          <button className={styles.themeToggle} onClick={onThemeToggle}>
            {theme === 'dark' ? <Sun size={13} strokeWidth={1.75} /> : <Moon size={13} strokeWidth={1.75} />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </Tooltip>
        {version && <span className={styles.version}>v{version}</span>}
      </div>

      {favFlyout && createPortal(
        <div
          className={styles.favFlyout}
          role="menu"
          style={{ top: favFlyout.top, left: favFlyout.left }}
          onMouseEnter={cancelCloseFavFlyout}
          onMouseLeave={scheduleCloseFavFlyout}
        >
          <div className={styles.favFlyoutHeader}>
            <Star size={11} strokeWidth={1.75} />
            Favorites
          </div>
          {(favorites[favFlyout.connId] ?? []).length === 0 ? (
            <div className={styles.favEmpty}>
              No favorites yet. Click the star in Browse to save a folder here.
            </div>
          ) : (
            (favorites[favFlyout.connId] ?? []).map((path) => (
              <div key={path} className={styles.favRow}>
                <button
                  className={styles.favItem}
                  title={path}
                  onClick={() => { onNavigateFavorite(favFlyout.connId, path); setFavFlyout(null) }}
                >
                  <Folder size={12} strokeWidth={1.75} />
                  <span className={styles.favItemName}>{favName(path)}</span>
                </button>
                <button
                  className={styles.favRemove}
                  title="Remove from favorites"
                  aria-label="Remove from favorites"
                  onClick={() => onRemoveFavorite(favFlyout.connId, path)}
                >
                  <X size={11} strokeWidth={2} />
                </button>
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </aside>
  )
}
