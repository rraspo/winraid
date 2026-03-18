import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pencil } from 'lucide-react'
import ConnectionIcon, { LUCIDE_ICONS } from './ConnectionIcon'
import styles from './IconPicker.module.css'

const METADATA_URL = 'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/metadata.json'
const CDN          = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg'

// Module-level cache so metadata is only fetched once per session
let servicesCache = null

const EMOJI_LIST = [
  '🖥️', '💻', '🖨️', '📁', '📂', '🗄️', '💾', '📀', '🔑', '🔒',
  '🌐', '🏠', '📡', '🔧', '⚙️', '🛡️', '⚡', '📦', '🗃️', '☁️',
  '🔌', '📶', '🧩', '🗂️', '📊', '🔐', '🌍', '🖱️', '⌨️', '🚀',
  '🏷️', '🎛️', '📬', '🗝️', '📸', '🎬', '🎵', '🎮', '🌩️', '🔋',
]

export default function IconPicker({ value, onChange }) {
  const [open,        setOpen]        = useState(false)
  const [tab,         setTab]         = useState('icons')
  const [search,      setSearch]      = useState('')
  const [services,    setServices]    = useState(null)
  const [serviceErr,  setServiceErr]  = useState(null)
  const [customEmoji, setCustomEmoji] = useState('')
  const [pos,         setPos]         = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  function openPicker() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const top  = rect.bottom + 6
      const left = Math.min(rect.left, window.innerWidth - 294)
      setPos({ top, left })
    }
    setOpen((v) => !v)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Reset search when switching tabs
  useEffect(() => { setSearch('') }, [tab])

  // Fetch services metadata (once)
  useEffect(() => {
    if (tab !== 'services' || serviceErr) return
    if (servicesCache) { setServices(servicesCache); return }
    if (services !== null) return
    fetch(METADATA_URL)
      .then((r) => r.json())
      .then((data) => {
        let names = []
        if (Array.isArray(data)) {
          names = data.map((item) => (typeof item === 'string' ? item : item.name)).filter(Boolean)
        } else if (data?.icons) {
          names = data.icons.map((item) => (typeof item === 'string' ? item : item.name)).filter(Boolean)
        }
        names.sort()
        servicesCache = names
        setServices(names)
      })
      .catch(() => setServiceErr('Could not load service icons'))
  }, [tab, services, serviceErr])

  function select(type, val) {
    onChange({ type, value: val })
    setOpen(false)
  }

  const q = search.toLowerCase()
  const filteredIcons    = q ? LUCIDE_ICONS.filter((e) => e.name.toLowerCase().includes(q)) : LUCIDE_ICONS
  const filteredServices = q && services ? services.filter((s) => s.includes(q)) : (services ?? [])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={openPicker}
        title="Change icon"
      >
        <ConnectionIcon icon={value} size={18} />
        <Pencil size={10} className={styles.triggerPencil} />
      </button>

      {open && createPortal(
        <div ref={popoverRef} className={styles.popover} style={{ top: pos.top, left: pos.left }}>

          {/* Tabs */}
          <div className={styles.tabBar}>
            {[['icons', 'Icons'], ['emoji', 'Emoji'], ['services', 'Services']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={[styles.tabBtn, tab === id ? styles.tabBtnActive : ''].join(' ')}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.tabDivider} />

          {/* Search row — icons and services only */}
          {tab !== 'emoji' && (
            <div className={styles.searchRow}>
              <input
                className={styles.searchInput}
                placeholder={tab === 'icons' ? 'Filter icons…' : 'Search services…'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {/* Icons tab */}
          {tab === 'icons' && (
            <div className={styles.grid}>
              {filteredIcons.map(({ name, Icon }) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  className={[
                    styles.gridItem,
                    value?.type === 'lucide' && value?.value === name ? styles.gridItemActive : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => select('lucide', name)}
                >
                  <Icon size={18} strokeWidth={1.75} />
                </button>
              ))}
            </div>
          )}

          {/* Emoji tab */}
          {tab === 'emoji' && (
            <div className={styles.emojiContent}>
              <div className={styles.emojiGrid}>
                {EMOJI_LIST.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={[
                      styles.emojiItem,
                      value?.type === 'emoji' && value?.value === emoji ? styles.emojiItemActive : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => select('emoji', emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className={styles.customRow}>
                <input
                  className={styles.customInput}
                  placeholder="Paste any emoji…"
                  value={customEmoji}
                  onChange={(e) => setCustomEmoji(e.target.value)}
                  maxLength={4}
                />
                <button
                  type="button"
                  className={styles.customApply}
                  disabled={!customEmoji.trim()}
                  onClick={() => { if (customEmoji.trim()) select('emoji', customEmoji.trim()) }}
                >
                  Use
                </button>
              </div>
            </div>
          )}

          {/* Services tab */}
          {tab === 'services' && (
            <div className={styles.serviceContent}>
              {serviceErr ? (
                <div className={styles.serviceErr}>{serviceErr}</div>
              ) : services === null ? (
                <div className={styles.serviceLoading}>Loading service icons…</div>
              ) : (
                <div className={styles.serviceGrid}>
                  {filteredServices.slice(0, 96).map((name) => (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      className={[
                        styles.serviceItem,
                        value?.type === 'service' && value?.value === name ? styles.gridItemActive : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => select('service', name)}
                    >
                      <img
                        src={`${CDN}/${name}.svg`}
                        width={24}
                        height={24}
                        alt={name}
                        style={{ objectFit: 'contain', display: 'block' }}
                        onError={(e) => { e.currentTarget.style.opacity = '0.15' }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>,
        document.body
      )}
    </>
  )
}
