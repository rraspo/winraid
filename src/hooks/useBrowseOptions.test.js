import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBrowseOptions } from './useBrowseOptions'

// Contract under test — per-view browse preferences (thumbnails, column
// visibility, density, hidden files) persist on the connection record via
// config.set('connections', ...), the same allowlisted write path every
// other per-connection setting (localFolder, folderMode, favorites) already
// uses — not localStorage, so they can never end up living only in
// render-time state the way the default-connection pin once did.

const CONN = { id: 'conn-1', name: 'Atlas', sftp: { remotePath: '/mnt/user/media' } }

beforeEach(() => {
  window.winraid = { config: { set: vi.fn().mockResolvedValue(undefined) } }
})

afterEach(() => {
  delete window.winraid
})

function setup(connections = [CONN]) {
  const setConnections = vi.fn()
  const { result, rerender } = renderHook(
    ({ conns }) => useBrowseOptions({
      selectedId: 'conn-1',
      selectedConn: conns.find((c) => c.id === 'conn-1'),
      connections: conns,
      setConnections,
    }),
    { initialProps: { conns: connections } },
  )
  return { result, rerender, setConnections }
}

describe('useBrowseOptions — defaults', () => {
  it('defaults to thumbnails on, every column visible, default density, hidden files off', () => {
    const { result } = setup()
    expect(result.current.browseOptions).toEqual({
      thumbnails: true,
      columns: { size: true, modified: true, kind: true },
      density: 'default',
      showHidden: false,
    })
  })

  it('reads back a connection that already has saved options', () => {
    const conn = { ...CONN, browseOptions: { thumbnails: false, columns: { size: false, modified: true, kind: true }, density: 'compact', showHidden: true } }
    const { result } = setup([conn])
    expect(result.current.browseOptions).toEqual(conn.browseOptions)
  })
})

describe('useBrowseOptions — writes', () => {
  it('setThumbnailsEnabled persists onto the connection record via config.set', () => {
    const { result, setConnections } = setup()
    act(() => result.current.setThumbnailsEnabled(false))
    expect(window.winraid.config.set).toHaveBeenCalledWith('connections', [
      { ...CONN, browseOptions: { thumbnails: false, columns: { size: true, modified: true, kind: true }, density: 'default', showHidden: false } },
    ])
    expect(setConnections).toHaveBeenCalled()
  })

  it('setColumnVisible patches a single column without disturbing the others', () => {
    const { result } = setup()
    act(() => result.current.setColumnVisible('modified', false))
    const [, updated] = window.winraid.config.set.mock.calls[0]
    expect(updated[0].browseOptions.columns).toEqual({ size: true, modified: false, kind: true })
  })

  it('setDensity and setShowHiddenFiles persist their own fields', () => {
    const { result } = setup()
    act(() => result.current.setDensity('roomy'))
    act(() => result.current.setShowHiddenFiles(true))
    const last = window.winraid.config.set.mock.calls.at(-1)[1]
    expect(last[0].browseOptions.showHidden).toBe(true)
  })

  it('never touches another connection in the array', () => {
    const other = { id: 'conn-2', name: 'Vault' }
    const { result } = setup([CONN, other])
    act(() => result.current.setThumbnailsEnabled(false))
    const [, updated] = window.winraid.config.set.mock.calls[0]
    expect(updated.find((c) => c.id === 'conn-2')).toEqual(other)
  })

  it('is a no-op without a selected connection', () => {
    const { result } = renderHook(() => useBrowseOptions({
      selectedId: null, selectedConn: null, connections: [CONN], setConnections: vi.fn(),
    }))
    act(() => result.current.setThumbnailsEnabled(false))
    expect(window.winraid.config.set).not.toHaveBeenCalled()
  })
})
