import { X, FileText } from 'lucide-react'
import ConnectionIcon from './ConnectionIcon'
import Tooltip from './ui/Tooltip'
import styles from './TabBar.module.css'

export default function TabBar({ openTabs, activeTabId, connections, dirtyTabs, onActivate, onClose }) {
  if (!openTabs.length) return null

  const connMap = Object.fromEntries((connections ?? []).map((c) => [c.id, c]))

  return (
    <div className={styles.tabBar}>
      {openTabs.map((tab) => {
        const conn     = connMap[tab.connId]
        const isActive = tab.id === activeTabId
        const isEditor = tab.type === 'editor'
        const isDirty  = dirtyTabs?.has(tab.id)
        return (
          <div
            key={tab.id}
            data-tabid={tab.id}
            className={[styles.tab, isActive ? styles.tabActive : ''].filter(Boolean).join(' ')}
            onClick={() => onActivate(tab.id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id) } }}
          >
            {isEditor
              ? <FileText size={12} />
              : <ConnectionIcon icon={conn?.icon ?? null} size={12} />}
            <span>{isEditor ? tab.name : (conn?.name ?? tab.connId)}</span>
            {isEditor
              ? (isDirty && <span className={styles.dirtyDot} title="Unsaved changes">●</span>)
              : <span className={styles.tabType}>{tab.type}</span>}
            <Tooltip tip="Close tab" side="top">
              <button
                className={styles.closeBtn}
                title="Close tab"
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
