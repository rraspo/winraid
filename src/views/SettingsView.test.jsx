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

  // The browser settings sit in their own card on the redesign; there is
  // no Advanced disclosure to open first.
  async function mountAndOpenAdvanced(opts) {
    mountWith(opts)
    render(<SettingsView />)
    await act(async () => {})
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

  it('renders the cards in prototype order with no Advanced disclosure', async () => {
    render(<SettingsView />)
    await act(async () => {})
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Startup & background', 'Appearance', 'Play', 'Snapshot', 'Thumbnails', 'Remote browser', 'Updates', 'Security'])
    expect(screen.queryByRole('button', { name: /Advanced settings/i })).toBeNull()
  })
})

// The redesign lays every setting out in cards; nothing hides behind a
// disclosure any more, and the old open/closed persistence key is gone.
describe('SettingsView — browser and cache settings are always visible', () => {
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

  it('shows the browser cache controls without any disclosure', async () => {
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Advanced settings/i })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Stale while revalidate' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'JPEG' })).toBeTruthy()
  })

  it('shows the thumbnail cache control in its card', async () => {
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy()
  })

  it('never touches the retired disclosure key', async () => {
    localStorage.setItem('settings-advanced-open', 'true')
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Advanced settings/i })).toBeNull()
    expect(localStorage.getItem('settings-advanced-open')).toBe('true')
  })
})
