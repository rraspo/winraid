import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import SettingsView from './SettingsView'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — Settings owns which connection the connection-driven
// screens open on. Browse, Backup, Size and the Play wall all have to pick
// one, and until now that was inferred rather than chosen.
//
// DOM contract:
//   - a card headed "Connections", present only when there is more than one
//     connection to choose between
//   - inside it a radiogroup labelled "Default connection" whose first option
//     is "Last used", followed by one option per configured connection,
//     labelled by name and described by its remote path
//   - the checked option reflects the stored `defaultConnection`: a
//     connection id checks that connection, null checks "Last used"
//   - choosing a connection writes config.set('defaultConnection', <id>)
//   - choosing "Last used" writes config.set('defaultConnection', null)

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas',   type: 'sftp', sftp: { remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault',   type: 'sftp', sftp: { remotePath: '/mnt/user/docs' } },
  { id: 'c3', name: 'Archive', type: 'smb',  smb:  { remotePath: '/archive' } },
]

function setup({ connections = CONNECTIONS, defaultConnection = null } = {}) {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'appearance')        return Promise.resolve({})
        if (key === 'playDefaults')      return Promise.resolve({ recursive: true, shuffle: false })
        if (key === 'connections')       return Promise.resolve(connections)
        if (key === 'defaultConnection') return Promise.resolve(defaultConnection)
        return Promise.resolve({ connections, defaultConnection })
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  })
  window.winraid.system = {
    accentColor:          vi.fn().mockResolvedValue('#0078D4'),
    onAccentColorChanged: vi.fn().mockReturnValue(() => {}),
  }
}

async function mount() {
  render(<SettingsView />)
  await act(async () => {})
}

function group() {
  return screen.getByRole('radiogroup', { name: 'Default connection' })
}

function option(name) {
  return within(group()).getByRole('radio', { name })
}

afterEach(() => { delete window.winraid })

describe('the default connection setting', () => {
  it('lists "Last used" and every connection', async () => {
    setup()
    await mount()
    const names = within(group()).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))
    expect(names).toEqual(['Last used', 'Atlas', 'Vault', 'Archive'])
  })

  it('describes each connection by its remote path', async () => {
    setup()
    await mount()
    expect(option('Atlas').textContent).toContain('/mnt/user/media')
    expect(option('Archive').textContent).toContain('/archive')
  })

  it('checks "Last used" when nothing is pinned', async () => {
    setup({ defaultConnection: null })
    await mount()
    expect(option('Last used').getAttribute('aria-checked')).toBe('true')
  })

  it('checks the pinned connection', async () => {
    setup({ defaultConnection: 'c2' })
    await mount()
    expect(option('Vault').getAttribute('aria-checked')).toBe('true')
    expect(option('Last used').getAttribute('aria-checked')).toBe('false')
  })

  it('pins a connection when it is chosen', async () => {
    setup({ defaultConnection: null })
    await mount()
    fireEvent.click(option('Archive'))
    await act(async () => {})
    expect(window.winraid.config.set).toHaveBeenCalledWith('defaultConnection', 'c3')
  })

  it('returns to "last used" when that is chosen', async () => {
    setup({ defaultConnection: 'c2' })
    await mount()
    fireEvent.click(option('Last used'))
    await act(async () => {})
    expect(window.winraid.config.set).toHaveBeenCalledWith('defaultConnection', null)
  })

  it('stays out of the way when there is nothing to choose between', async () => {
    setup({ connections: [CONNECTIONS[0]] })
    await mount()
    expect(screen.queryByRole('radiogroup', { name: 'Default connection' })).toBeNull()
  })
})
