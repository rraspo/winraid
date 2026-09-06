import {
  LayoutDashboard, Server, ListOrdered, Folder, Play, PieChart, Download,
  FileText, Monitor, Sun, Moon, Settings,
} from 'lucide-react'
import styles from './NavRail.module.css'

// The nav rail is the app's only primary navigation, so the order below is
// the order users learn; the ids are the view ids App routes on.
const NAV_ITEMS = [
  { id: 'dashboard',   label: 'Dashboard',   Icon: LayoutDashboard },
  { id: 'connections', label: 'Connections', Icon: Server },
  { id: 'queue',       label: 'Queue',       Icon: ListOrdered },
  { id: 'browse',      label: 'Browse',      Icon: Folder },
  { id: 'play',        label: 'Play wall',   Icon: Play },
  { id: 'size',        label: 'Size map',    Icon: PieChart },
  { id: 'backup',      label: 'Backup',      Icon: Download },
  { id: 'logs',        label: 'Logs',        Icon: FileText },
]

function NavButton({ id, label, Icon, activeView, onNavigate }) {
  const isActive = activeView === id
  return (
    <button
      type="button"
      className={[styles.item, isActive ? styles.active : ''].filter(Boolean).join(' ')}
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onNavigate(id)}
    >
      {isActive && <span className={styles.activeBar} />}
      <Icon size={20} strokeWidth={1.6} />
      <span className={styles.label}>{label}</span>
    </button>
  )
}

export default function NavRail({ activeView, onNavigate, theme, onThemeToggle, onOpenTray }) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const ThemeIcon = theme === 'dark' ? Sun : Moon

  return (
    <nav className={styles.rail} aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <NavButton key={item.id} {...item} activeView={activeView} onNavigate={onNavigate} />
      ))}

      <div className={styles.spacer} />

      {onOpenTray && (
        <button type="button" className={styles.item} onClick={onOpenTray}>
          <Monitor size={20} strokeWidth={1.6} />
          <span className={styles.label}>Tray</span>
        </button>
      )}

      <button
        type="button"
        className={styles.item}
        title={`Switch to ${nextTheme} theme`}
        onClick={onThemeToggle}
      >
        <ThemeIcon size={20} strokeWidth={1.6} />
        <span className={styles.label}>Theme</span>
      </button>

      <NavButton id="settings" label="Settings" Icon={Settings} activeView={activeView} onNavigate={onNavigate} />
    </nav>
  )
}
