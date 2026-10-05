import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import SettingsView from './SettingsView'
import { createWinraidMock } from '../__mocks__/winraid'
import { CONFIG_SET_ALLOWLIST } from '../../electron/config-allowlist.js'

// Contract under test — each SFTP connection chooses whether it has a trash,
// and where.
//
// With no trash folder, a remote delete is permanent. With one, deletes move
// into it and can be restored. The folder is checked on the NAS before it is
// saved, because a folder the file would have to be copied into makes every
// delete slow; a folder that fails the check is never saved.
//
// DOM contract:
//   - a card labelled "Trash", present only when there is an SFTP connection
//     (SMB connections cannot delete remotely, so they are not listed)
//   - one text field per SFTP connection labelled "Trash folder for <name>",
//     showing the stored folder
//   - a connection with no folder says its deletes are permanent
//   - "Save trash folder for <name>" checks the folder with
//     remote.trashCheck(id, folder); only { ok: true } writes
//     config.set('trashByConnection', map) with { [id]: { folder } } merged
//     into what was stored, and confirms it was saved
//   - a failed check shows its error as an alert and writes nothing
//   - "Turn off trash for <name>" removes that connection from the map
//     without a check, and says deletes are permanent again

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas',   type: 'sftp', sftp: { remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault',   type: 'sftp', sftp: { remotePath: '/mnt/user/docs' } },
  { id: 'c3', name: 'Archive', type: 'smb',  smb:  { remotePath: '/archive' } },
]

function setup({ connections = CONNECTIONS, trashByConnection = {}, check = { ok: true } } = {}) {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'appearance')        return Promise.resolve({})
        if (key === 'playDefaults')      return Promise.resolve({ recursive: true, shuffle: false })
        if (key === 'connections')       return Promise.resolve(connections)
        if (key === 'defaultConnection') return Promise.resolve(null)
        if (key === 'trashByConnection') return Promise.resolve(trashByConnection)
        return Promise.resolve({ connections, trashByConnection })
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
    remote: {
      trashCheck: vi.fn().mockResolvedValue(check),
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

const card = () => screen.getByRole('region', { name: 'Trash' })
const field = (name) => within(card()).getByRole('textbox', { name: `Trash folder for ${name}` })
const button = (name) => within(card()).getByRole('button', { name })

function trashWrites() {
  return window.winraid.config.set.mock.calls.filter(([key]) => key.split('.')[0] === 'trashByConnection')
}

afterEach(() => { delete window.winraid })

describe('the per-connection trash setting', () => {
  it('is a key the renderer is allowed to save', () => {
    expect(CONFIG_SET_ALLOWLIST).toContain('trashByConnection')
  })

  it('lists a field for each SFTP connection and none for SMB', async () => {
    setup()
    await mount()
    expect(field('Atlas')).toBeInTheDocument()
    expect(field('Vault')).toBeInTheDocument()
    expect(within(card()).queryByRole('textbox', { name: 'Trash folder for Archive' })).toBeNull()
  })

  it('is absent when there is no SFTP connection', async () => {
    setup({ connections: [CONNECTIONS[2]] })
    await mount()
    expect(screen.queryByRole('region', { name: 'Trash' })).toBeNull()
  })

  it('shows the stored folder', async () => {
    setup({ trashByConnection: { c1: { folder: '/mnt/user/media' } } })
    await mount()
    expect(field('Atlas')).toHaveValue('/mnt/user/media')
    expect(field('Vault')).toHaveValue('')
  })

  it('says a connection with no trash folder deletes permanently', async () => {
    setup({ trashByConnection: { c1: { folder: '/mnt/user/media' } } })
    await mount()
    const vaultRow = field('Vault').closest('[data-trash-connection]')
    expect(vaultRow).not.toBeNull()
    expect(vaultRow).toHaveTextContent(/permanent/i)
    expect(field('Atlas').closest('[data-trash-connection]')).not.toHaveTextContent(/permanent/i)
  })

  it('checks the folder on the NAS, then saves it and confirms', async () => {
    setup({ trashByConnection: { c1: { folder: '/mnt/user/media' } } })
    await mount()

    fireEvent.change(field('Vault'), { target: { value: '/mnt/user/docs' } })
    await act(async () => { fireEvent.click(button('Save trash folder for Vault')) })

    expect(window.winraid.remote.trashCheck).toHaveBeenCalledWith('c2', '/mnt/user/docs')
    expect(trashWrites()).toEqual([[
      'trashByConnection',
      { c1: { folder: '/mnt/user/media' }, c2: { folder: '/mnt/user/docs' } },
    ]])
    expect(within(card()).getByText(/saved/i)).toBeInTheDocument()
  })

  it('shows why a folder was refused and saves nothing', async () => {
    setup({ check: { ok: false, error: 'Every delete would copy the file into this folder.' } })
    await mount()

    fireEvent.change(field('Atlas'), { target: { value: '/mnt/cache/trash' } })
    await act(async () => { fireEvent.click(button('Save trash folder for Atlas')) })

    expect(within(card()).getByRole('alert')).toHaveTextContent('Every delete would copy the file into this folder.')
    expect(trashWrites()).toEqual([])
  })

  it('turns the trash off without a check, and says deletes are permanent again', async () => {
    setup({ trashByConnection: { c1: { folder: '/mnt/user/media' }, c2: { folder: '/mnt/user/docs' } } })
    await mount()

    await act(async () => { fireEvent.click(button('Turn off trash for Atlas')) })

    expect(window.winraid.remote.trashCheck).not.toHaveBeenCalled()
    expect(trashWrites()).toEqual([['trashByConnection', { c2: { folder: '/mnt/user/docs' } }]])
    expect(field('Atlas').closest('[data-trash-connection]')).toHaveTextContent(/permanent/i)
  })
})
