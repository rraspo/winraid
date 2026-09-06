import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import iconSrc from '../../../assets/winraid_icon_32x32.png'
import styles from './TitleBar.module.css'

// The window's own chrome, replacing the OS title bar now that the
// BrowserWindow is created with titleBarStyle: 'hidden'. The drag region
// carries -webkit-app-region: drag so the window can still be moved and
// double-click-maximized; the controls opt back out with no-drag.
export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  // Every call goes through windowBridge() so a preload that predates the
  // window namespace (dev restart, version skew) leaves the bar inert
  // instead of taking the whole shell down.
  const windowBridge = () => window.winraid?.window

  useEffect(() => {
    let cancelled = false
    windowBridge()?.isMaximized?.().then((maximized) => {
      if (!cancelled) setIsMaximized(!!maximized)
    })
    const unsubscribe = windowBridge()?.onMaximizedChanged?.((maximized) => {
      setIsMaximized(!!maximized)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  function toggleMaximize() {
    windowBridge()?.toggleMaximize?.()
  }

  return (
    <header className={styles.bar}>
      <div className={styles.dragRegion} onDoubleClick={toggleMaximize}>
        <img src={iconSrc} className={styles.icon} alt="" />
        <span className={styles.title}>WinRaid</span>
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.control}
          aria-label="Minimize"
          onClick={() => windowBridge()?.minimize?.()}
        >
          <Minus size={10} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className={styles.control}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          onClick={toggleMaximize}
        >
          {isMaximized ? <Copy size={10} strokeWidth={1.5} /> : <Square size={10} strokeWidth={1.5} />}
        </button>
        <button
          type="button"
          className={[styles.control, styles.close].join(' ')}
          aria-label="Close"
          onClick={() => windowBridge()?.close?.()}
        >
          <X size={10} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  )
}
