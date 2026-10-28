import { useEffect, useState } from 'react'
import { normalizeAppearance, resolveAccentHex, resolveTheme, onAccentTextColor } from '../utils/accent'

// Loads the saved appearance and applies it to this window's document: the
// resolved theme as data-theme on <html>, the accent as --accent/--onAccent.
// tokens.css defaults :root to the dark palette, so every window that skips
// this renders dark whatever the user chose.
//
// Follows a 'system' theme as the OS preference changes, the live Windows
// accent, appearance changes SettingsView announces in this window, and, on
// focus, changes made in another window — the tray flyout is hidden, not
// closed, between opens.
export function useAppearance() {
  const [appearance, setAppearance] = useState(() => normalizeAppearance(undefined))
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  )
  const [systemAccentHex, setSystemAccentHex] = useState(null)
  const resolvedTheme = resolveTheme(appearance.theme, systemPrefersDark)

  // Installs that predate the appearance setting hold the theme in
  // localStorage under 'winraid-theme'; it wins over the default exactly once
  // and is then removed, so an explicit choice in Settings can never be
  // overridden by the stale key.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      window.winraid?.config?.get('appearance').then((raw) => {
        if (cancelled) return
        const legacyTheme = localStorage.getItem('winraid-theme')
        if ((legacyTheme === 'dark' || legacyTheme === 'light') && raw?.theme == null) {
          const migrated = { ...normalizeAppearance(raw), theme: legacyTheme }
          setAppearance(migrated)
          window.winraid?.config.set('appearance', migrated)
          localStorage.removeItem('winraid-theme')
        } else {
          setAppearance(normalizeAppearance(raw))
        }
      }).catch(() => {})
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      window.removeEventListener('focus', load)
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const handleChange = (e) => setSystemPrefersDark(e.matches)
    media.addEventListener?.('change', handleChange)
    return () => media.removeEventListener?.('change', handleChange)
  }, [])

  useEffect(() => {
    function handleAppearanceChanged(e) {
      if (e.detail) setAppearance(normalizeAppearance(e.detail))
    }
    window.addEventListener('winraid:appearance-changed', handleAppearanceChanged)
    return () => window.removeEventListener('winraid:appearance-changed', handleAppearanceChanged)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    if (!window.winraid?.system) return
    let cancelled = false
    window.winraid.system.accentColor().then((hex) => {
      if (!cancelled) setSystemAccentHex(hex ?? null)
    }).catch(() => {})
    const unsubscribe = window.winraid.system.onAccentColorChanged((hex) => {
      setSystemAccentHex(hex ?? null)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const accentHex = resolveAccentHex(appearance.accent, systemAccentHex)
    document.documentElement.style.setProperty('--accent', accentHex)
    document.documentElement.style.setProperty('--onAccent', onAccentTextColor(accentHex))
  }, [appearance.accent, systemAccentHex])

  return { appearance, setAppearance, resolvedTheme }
}
