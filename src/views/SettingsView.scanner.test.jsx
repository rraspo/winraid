import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SettingsView from './SettingsView'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — "Start scanner" never fails silently.
//
// Starting scanners can do nothing for two reasons: no connection has a watch
// folder, or the main process refuses a connection (its folder is missing,
// unreadable, ...). Either way the button used to leave the screen unchanged,
// so the user could not tell a refusal from a click that did not register.

function mountWith(connections, start = vi.fn().mockResolvedValue({ ok: true })) {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === undefined)      return Promise.resolve({ connections })
        if (key === 'playDefaults') return Promise.resolve({ recursive: true, shuffle: false })
        return Promise.resolve({})
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
    watcher: { start },
  })
  render(<SettingsView />)
  return start
}

async function clickStart() {
  await act(async () => {})
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start scanner' })) })
}

afterEach(() => { delete window.winraid })

describe('SettingsView — Start scanner feedback', () => {
  it('says why nothing started when no connection has a watch folder', async () => {
    const start = mountWith([
      { id: 'c1', name: 'Atlas', localFolder: '' },
      { id: 'c2', name: 'Vault' },
    ])
    await clickStart()
    expect(start).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/No connection has a watch folder.*Connections/)
  })

  it('names each connection the main process refused, with its reason', async () => {
    const start = vi.fn().mockImplementation((id) => Promise.resolve(
      id === 'c2' ? { ok: false, error: 'local folder does not exist or is not a directory' } : { ok: true },
    ))
    mountWith([
      { id: 'c1', name: 'Atlas', localFolder: 'C:\\sync' },
      { id: 'c2', name: 'Vault', localFolder: 'C:\\gone' },
    ], start)
    await clickStart()
    expect(start).toHaveBeenCalledTimes(2)
    const alert = screen.getByRole('alert').textContent
    expect(alert).toContain('Vault')
    expect(alert).toContain('local folder does not exist or is not a directory')
    expect(alert).not.toContain('Atlas')
  })

  it('reports a failed start call instead of dropping it', async () => {
    mountWith(
      [{ id: 'c1', name: 'Atlas', localFolder: 'C:\\sync' }],
      vi.fn().mockRejectedValue(new Error('IPC channel closed')),
    )
    await clickStart()
    expect(screen.getByRole('alert').textContent).toMatch(/Atlas.*IPC channel closed/)
  })

  it('shows no error when every scanner starts', async () => {
    const start = mountWith([{ id: 'c1', name: 'Atlas', localFolder: 'C:\\sync' }])
    await clickStart()
    expect(start).toHaveBeenCalledWith('c1')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
