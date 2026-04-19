import { X } from 'lucide-react'
import ConnectionIcon from './ConnectionIcon'
import Tooltip from './ui/Tooltip'
import styles from './TabBar.module.css'

export default function TabBar({ openTabs, activeTabId, connections, onActivate, onClose }) {
  if (!openTabs.length) return null

  const connMap = Object.fromEntries((connections ?? []).map((c) => [c.id, c]))

  return (
    <div className={styles.tabBar}>
      {openTabs.map((tab) => {
        const conn     = connMap[tab.connId]
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            data-tabid={tab.id}
            className={[styles.tab, isActive ? styles.tabActive : ''].filter(Boolean).join(' ')}
            onClick={() => onActivate(tab.id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id) } }}
          >
            <ConnectionIcon icon={conn?.icon ?? null} size={12} />
            <span>{conn?.name ?? tab.connId}</span>
            <span className={styles.tabType}>{tab.type}</span>
            <Tooltip tip="Close tab" side="top">
              <button
                className={styles.closeBtn}
                onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}
