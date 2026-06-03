import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SettingsView from './SettingsView'
import { createWinraidMock } from '../__mocks__/winraid'

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'playDefaults') return Promise.resolve({ recursive: true, shuffle: false })
        return Promise.resolve({})
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  })
})

afterEach(() => { delete window.winraid })
afterEach(() => { localStorage.clear() })

describe('SettingsView — Play section', () => {
  it('renders the Play section heading', async () => {
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByText('Play')).toBeTruthy()
  })

  it('reads recursive default from config and shows it selected', async () => {
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByRole('radio', { name: 'Recursive' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Top level' }).getAttribute('aria-checked')).toBe('false')
  })

  it('reads shuffle default from config and shows it not selected', async () => {
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByRole('radio', { name: 'Shuffle' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: 'In order' }).getAttribute('aria-checked')).toBe('true')
  })

  it('choosing "Top level" writes recursive=false via config.set', async () => {
    render(<SettingsView />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('radio', { name: 'Top level' }))
    expect(window.winraid.config.set).toHaveBeenCalledWith(
      'playDefaults',
      expect.objectContaining({ recursive: false })
    )
  })

  it('choosing "Shuffle" writes shuffle=true via config.set', async () => {
    render(<SettingsView />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('radio', { name: 'Shuffle' }))
    expect(window.winraid.config.set).toHaveBeenCalledWith(
      'playDefaults',
      expect.objectContaining({ shuffle: true })
    )
  })
})

describe('SettingsView — Snapshot section', () => {
  function mountWith(formatValue) {
    window.winraid = createWinraidMock({
      config: {
        get: vi.fn().mockImplementation((key) => {
          if (key === 'snapshot.format') return Promise.resolve(formatValue)
          if (key === 'playDefaults')    return Promise.resolve({ recursive: true, shuffle: false })
          return Promise.resolve({})
        }),
        set: vi.fn().mockResolvedValue(undefined),
      },
    })
  }

  it('renders the Snapshot section heading', async () => {
    mountWith('jpeg')
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByText('Snapshot')).toBeTruthy()
  })

  it('renders all three format options as radio buttons in a segmented control', async () => {
    mountWith('jpeg')
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByRole('radio', { name: 'JPEG' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'PNG'  })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'WebP' })).toBeTruthy()
  })

  it('reads snapshot.format from config and marks JPEG checked by default', async () => {
    mountWith('jpeg')
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByRole('radio', { name: 'JPEG' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'PNG'  }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: 'WebP' }).getAttribute('aria-checked')).toBe('false')
  })

  it('reflects PNG when config returns "png"', async () => {
    mountWith('png')
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByRole('radio', { name: 'PNG' }).getAttribute('aria-checked')).toBe('true')
  })

  it('falls back to JPEG checked when config returns undefined', async () => {
    mountWith(undefined)
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByRole('radio', { name: 'JPEG' }).getAttribute('aria-checked')).toBe('true')
  })

  it('clicking PNG persists "png" via config.set', async () => {
    mountWith('jpeg')
    render(<SettingsView />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('radio', { name: 'PNG' }))
    expect(window.winraid.config.set).toHaveBeenCalledWith('snapshot.format', 'png')
  })

  it('clicking WebP persists "webp" via config.set', async () => {
    mountWith('jpeg')
    render(<SettingsView />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('radio', { name: 'WebP' }))
    expect(window.winraid.config.set).toHaveBeenCalledWith('snapshot.format', 'webp')
  })

  it('shows the active option\'s description below the control', async () => {
    mountWith('jpeg')
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByText('Smallest files for photo-like frames. Slight quality loss.')).toBeInTheDocument()
  })
})

describe('SettingsView — Browse section', () => {
  function mountWith({ cacheMode, cacheMutation } = {}) {
    window.winraid = createWinraidMock({
      config: {
        get: vi.fn().mockImplementation((key) => {
          if (key === 'browse') return Promise.resolve({
            cacheMode:     cacheMode     ?? 'stale',
            cacheMutation: cacheMutation ?? 'update',
          })
          if (key === 'playDefaults') return Promise.resolve({ recursive: true, shuffle: false })
          return Promise.resolve({})
        }),
        set: vi.fn().mockResolvedValue(undefined),
      },
    })
  }

  async function mountAndOpenAdvanced(opts) {
    mountWith(opts)
    render(<SettingsView />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Advanced settings/i }))
  }

  it('renders the Directory cache segmented control with three options', async () => {
    await mountAndOpenAdvanced()
    expect(screen.getByRole('radio', { name: 'Stale while revalidate' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Full tree on connect' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Always fetch' })).toBeTruthy()
  })

  it('reflects the current cacheMode from config', async () => {
    await mountAndOpenAdvanced({ cacheMode: 'tree' })
    expect(screen.getByRole('radio', { name: 'Full tree on connect' }).getAttribute('aria-checked')).toBe('true')
  })

  it('clicking a Directory cache option persists via config.set("browse.cacheMode", ...)', async () => {
    await mountAndOpenAdvanced()
    fireEvent.click(screen.getByRole('radio', { name: 'Always fetch' }))
    expect(window.winraid.config.set).toHaveBeenCalledWith('browse.cacheMode', 'none')
  })

  it('renders the On folder mutation segmented control with two options', async () => {
    await mountAndOpenAdvanced()
    expect(screen.getByRole('radio', { name: 'Update in place' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Re-fetch' })).toBeTruthy()
  })

  it('reflects the current cacheMutation from config', async () => {
    await mountAndOpenAdvanced({ cacheMutation: 'refetch' })
    expect(screen.getByRole('radio', { name: 'Re-fetch' }).getAttribute('aria-checked')).toBe('true')
  })

  it('clicking an On folder mutation option persists via config.set("browse.cacheMutation", ...)', async () => {
    await mountAndOpenAdvanced()
    fireEvent.click(screen.getByRole('radio', { name: 'Re-fetch' }))
    expect(window.winraid.config.set).toHaveBeenCalledWith('browse.cacheMutation', 'refetch')
  })
})

describe('SettingsView — structure', () => {
  beforeEach(() => {
    window.winraid = createWinraidMock({
      config: {
        get: vi.fn().mockImplementation((key) => {
          if (key === 'snapshot.format') return Promise.resolve('jpeg')
          if (key === 'playDefaults')    return Promise.resolve({ recursive: true, shuffle: false })
          if (key === 'browse')          return Promise.resolve({ cacheMode: 'stale', cacheMutation: 'update' })
          return Promise.resolve({})
        }),
        set: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('does not render a Scanner section', async () => {
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.queryByText('Scanner')).toBeNull()
  })

  it('renders sections in order: top, then Advanced (when expanded), then About', async () => {
    render(<SettingsView />)
    await act(async () => {})
    // Open Advanced so its inner subsections are present in the DOM.
    fireEvent.click(screen.getByRole('button', { name: /Advanced settings/i }))
    const headings = Array.from(document.querySelectorAll('[class*="sectionHeader"], [class*="subGroupHeader"]')).map((el) => el.textContent)
    const known = ['Interface', 'Appearance', 'Play', 'Snapshot', 'Browse', 'Storage', 'About']
    const ordered = headings.filter((h) => known.includes(h))
    expect(ordered[1]).toBe('Play')
    expect(ordered[2]).toBe('Snapshot')
    expect(ordered[3]).toBe('Browse')
    expect(ordered[4]).toBe('Storage')
    expect(ordered[5]).toBe('About')
  })
})

describe('SettingsView — Advanced accordion', () => {
  beforeEach(() => {
    localStorage.clear()
    window.winraid = createWinraidMock({
      config: {
        get: vi.fn().mockImplementation((key) => {
          if (key === 'snapshot.format') return Promise.resolve('jpeg')
          if (key === 'playDefaults')    return Promise.resolve({ recursive: true, shuffle: false })
          if (key === 'browse')          return Promise.resolve({ cacheMode: 'stale', cacheMutation: 'update' })
          return Promise.resolve({})
        }),
        set: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('renders the Advanced settings header', async () => {
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: /Advanced settings/i })).toBeTruthy()
  })

  it('defaults to closed: Browse controls are not visible', async () => {
    render(<SettingsView />)
    await act(async () => {})
    const header = screen.getByRole('button', { name: /Advanced settings/i })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('radio', { name: 'Stale while revalidate' })).toBeNull()
  })

  it('snapshot section remains outside the accordion and is always visible', async () => {
    render(<SettingsView />)
    await act(async () => {})
    // Advanced is closed; Snapshot must still render.
    expect(screen.getByRole('radio', { name: 'JPEG' })).toBeTruthy()
  })

  it('clicking the header opens the accordion: Browse controls become visible', async () => {
    render(<SettingsView />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Advanced settings/i }))
    expect(screen.getByRole('button', { name: /Advanced settings/i }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Stale while revalidate' })).toBeTruthy()
  })

  it('opening the accordion persists "true" to localStorage', async () => {
    render(<SettingsView />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Advanced settings/i }))
    expect(localStorage.getItem('settings-advanced-open')).toBe('true')
  })

  it('clicking again closes and persists "false"', async () => {
    render(<SettingsView />)
    await act(async () => {})
    const header = screen.getByRole('button', { name: /Advanced settings/i })
    fireEvent.click(header)
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(localStorage.getItem('settings-advanced-open')).toBe('false')
    expect(screen.queryByRole('radio', { name: 'Stale while revalidate' })).toBeNull()
  })

  it('reads localStorage on mount and opens if previously open', async () => {
    localStorage.setItem('settings-advanced-open', 'true')
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: /Advanced settings/i }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Stale while revalidate' })).toBeTruthy()
  })

  it('Thumbnail cache controls also live inside the accordion', async () => {
    render(<SettingsView />)
    await act(async () => {})
    // Closed by default — Clear cache button is hidden.
    expect(screen.queryByRole('button', { name: /Clear cache/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Advanced settings/i }))
    expect(screen.getByRole('button', { name: /Clear cache/i })).toBeTruthy()
  })
})
