import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../../__mocks__/winraid'
import * as remoteFS from '../../services/remoteFS'
import PropertiesModal from './PropertiesModal'

// Contract under test — the Properties dialog joins the modal family (a
// centered dialog, not a side pane) and shows, for a single selected entry,
// Identity, Size and time, Remote attributes and Mirror status in that
// order; a multi-selection collapses to a count/size/breakdown/mirror
// summary with no per-entry repetition. The folder-size scan never runs on
// open — an explicit control triggers it — and every async section that can
// fail says so rather than spinning forever.

const MIRROR_CONN = {
  id: 'conn-1',
  folderMode: 'mirror',
  localFolder: 'Z:\\sync',
  sftp: { remotePath: '/mnt/user/media' },
}

const FLAT_CONN = {
  id: 'conn-1',
  folderMode: 'flat',
  localFolder: '',
  sftp: { remotePath: '/mnt/user/media' },
}

const FILE_ENTRY = { name: 'clip.mp4', path: '/mnt/user/media/clip.mp4', type: 'file', size: 5242880, modified: 1700000000000 }
const DIR_ENTRY  = { name: 'Photos', path: '/mnt/user/media/Photos', type: 'dir', size: 0, modified: 1700000000000 }

let sizeLevelCb = null

function mockWinraid(overrides = {}) {
  sizeLevelCb = null
  window.winraid = createWinraidMock({
    remote: {
      onSizeLevel: vi.fn((cb) => { sizeLevelCb = cb; return () => {} }),
      sizeScanSubtree: vi.fn().mockResolvedValue({ ok: true }),
      list: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
      entryInfo: vi.fn().mockResolvedValue({
        ok: true, mode: '755', owner: 'user', group: 'users', created: null, isSymlink: false, symlinkTarget: null,
      }),
      ...overrides.remote,
    },
    local: {
      stat: vi.fn().mockResolvedValue({ ok: true, exists: false }),
      ...overrides.local,
    },
    queue: {
      list: vi.fn().mockResolvedValue([]),
      ...overrides.queue,
    },
  })
}

beforeEach(() => {
  mockWinraid()
})

afterEach(() => {
  remoteFS.clearAll()
  delete window.winraid
  vi.restoreAllMocks()
})

function renderModal(props = {}) {
  return render(
    <PropertiesModal
      entries={[FILE_ENTRY]}
      connectionId="conn-1"
      connection={MIRROR_CONN}
      copyPath={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  )
}

describe('PropertiesModal — single entry', () => {
  it('is a dialog named after the entry', async () => {
    renderModal()
    expect(await screen.findByRole('dialog', { name: 'clip.mp4 Properties' })).toBeTruthy()
  })

  it('shows Identity, Size and time, Remote attributes and Mirror status in order', async () => {
    renderModal()
    await screen.findByText('user') // wait for attrs to resolve
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Identity', 'Size and time', 'Remote attributes', 'Mirror status'])
  })

  it('shows name, full path and type under Identity', async () => {
    renderModal()
    expect(screen.getByText('clip.mp4')).toBeTruthy()
    expect(screen.getByText('/mnt/user/media/clip.mp4')).toBeTruthy()
    expect(screen.getByText('File')).toBeTruthy()
  })

  it('copies the full path via the same copyPath affordance as the breadcrumb', async () => {
    const copyPath = vi.fn()
    const user = userEvent.setup()
    renderModal({ copyPath })
    await user.click(screen.getByTitle('Copy full path'))
    expect(copyPath).toHaveBeenCalledWith('/mnt/user/media/clip.mp4')
  })

  it('shows the file size directly, no scan control for files', async () => {
    renderModal()
    expect(screen.getByText('5.0 MB')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Calculate size' })).toBeNull()
  })

  it('loads and shows remote attributes, including a formatted permission mode', async () => {
    renderModal()
    expect(screen.getAllByText(/Loading/).length).toBeGreaterThan(0)
    await screen.findByText('user')
    expect(screen.getByText('755 (rwxr-xr-x)')).toBeTruthy()
    expect(screen.getByText('users')).toBeTruthy()
  })

  it('surfaces an attribute-fetch failure instead of hanging on Loading', async () => {
    mockWinraid({ remote: { entryInfo: vi.fn().mockResolvedValue({ ok: false, error: 'Connection unavailable' }) } })
    renderModal()
    expect(await screen.findByText(/Could not read attributes: Connection unavailable/)).toBeTruthy()
  })

  it('shows a symlink target row only when the entry is a symlink', async () => {
    mockWinraid({
      remote: {
        entryInfo: vi.fn().mockResolvedValue({
          ok: true, mode: '777', owner: 'user', group: 'users', created: null, isSymlink: true, symlinkTarget: '/mnt/user/other/real.mp4',
        }),
      },
    })
    renderModal()
    await screen.findByText('/mnt/user/other/real.mp4')
    expect(screen.getByText('Symlink target')).toBeTruthy()
  })

  it('shows a Created row only when the server reports a birth time', async () => {
    mockWinraid({
      remote: {
        entryInfo: vi.fn().mockResolvedValue({
          ok: true, mode: '644', owner: 'user', group: 'users', created: 1690000000000, isSymlink: false, symlinkTarget: null,
        }),
      },
    })
    renderModal()
    await screen.findByText('Created')
  })

  it('omits Created when the server does not report a birth time', async () => {
    renderModal()
    await screen.findByText('user')
    expect(screen.queryByText('Created')).toBeNull()
  })
})

describe('PropertiesModal — folder size, on demand', () => {
  function renderFolder(overrides) {
    return renderModal({ entries: [DIR_ENTRY], ...overrides })
  }

  it('never scans on open — a Calculate size control appears instead of a value', async () => {
    renderFolder()
    expect(await screen.findByRole('button', { name: 'Calculate size' })).toBeTruthy()
    expect(window.winraid.remote.sizeScanSubtree).not.toHaveBeenCalled()
  })

  it('shows a spinner while scanning, then the total once every subfolder resolves', async () => {
    mockWinraid({
      remote: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          entries: [
            { name: 'a.jpg', type: 'file', size: 2048, modified: 0 },
            { name: 'sub',   type: 'dir',  size: 0,    modified: 0 },
          ],
        }),
      },
    })
    const user = userEvent.setup()
    renderFolder()
    await user.click(await screen.findByRole('button', { name: 'Calculate size' }))
    expect(await screen.findByText(/Calculating/)).toBeTruthy()

    act(() => {
      sizeLevelCb({
        connectionId: 'conn-1',
        parentPath: '/mnt/user/media/Photos',
        entries: [{ name: 'sub', path: '/mnt/user/media/Photos/sub', sizeKb: 100 }],
      })
    })

    // 2048 bytes (a.jpg) + 100 KB (sub, recursively sized by the tool) = 104448 bytes -> "102.0 KB"
    await waitFor(() => expect(screen.getByText('102.0 KB')).toBeTruthy())
  })

  it('resolves immediately for a folder with no subfolders — no subtree scan needed', async () => {
    mockWinraid({
      remote: {
        list: vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'a.jpg', type: 'file', size: 1024, modified: 0 }] }),
      },
    })
    const user = userEvent.setup()
    renderFolder()
    await user.click(await screen.findByRole('button', { name: 'Calculate size' }))
    await waitFor(() => expect(screen.getByText('1.0 KB')).toBeTruthy())
    expect(window.winraid.remote.sizeScanSubtree).not.toHaveBeenCalled()
  })

  it('surfaces a scan failure instead of spinning forever', async () => {
    mockWinraid({
      remote: {
        list: vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'sub', type: 'dir', size: 0, modified: 0 }] }),
        sizeScanSubtree: vi.fn().mockResolvedValue({ ok: false, error: 'Connection unavailable' }),
      },
    })
    const user = userEvent.setup()
    renderFolder()
    await user.click(await screen.findByRole('button', { name: 'Calculate size' }))
    expect(await screen.findByText(/Connection unavailable/)).toBeTruthy()
  })
})

describe('PropertiesModal — mirror status', () => {
  it('reads not-applicable for a connection with no local folder, never an empty section', async () => {
    renderModal({ connection: FLAT_CONN })
    expect(await screen.findByText(/doesn.t mirror to a local folder/)).toBeTruthy()
    expect(window.winraid.local.stat).not.toHaveBeenCalled()
  })

  it('reports no local copy when the mirror path does not exist on disk', async () => {
    renderModal()
    expect(await screen.findByText('Not present')).toBeTruthy()
  })

  it('reports a matching copy, its last-write time and queued state', async () => {
    mockWinraid({
      local: { stat: vi.fn().mockResolvedValue({ ok: true, exists: true, size: FILE_ENTRY.size, mtime: FILE_ENTRY.modified }) },
      queue: { list: vi.fn().mockResolvedValue([{ srcPath: 'Z:\\sync\\clip.mp4', status: 'PENDING' }]) },
    })
    renderModal()
    expect(await screen.findByText('Present')).toBeTruthy()
    expect(screen.getByText('Match')).toBeTruthy()
    expect(screen.getByText('Yes')).toBeTruthy()
  })

  it('reports a stale copy as different and not queued', async () => {
    mockWinraid({
      local: { stat: vi.fn().mockResolvedValue({ ok: true, exists: true, size: 1, mtime: 1 }) },
      queue: { list: vi.fn().mockResolvedValue([]) },
    })
    renderModal()
    expect(await screen.findByText('Present')).toBeTruthy()
    expect(screen.getByText('Different')).toBeTruthy()
    expect(screen.getByText('No')).toBeTruthy()
  })
})

describe('PropertiesModal — multi-selection', () => {
  it('collapses to count, combined size, a type breakdown and a mirror summary, no per-entry repetition', async () => {
    mockWinraid({ local: { stat: vi.fn().mockResolvedValue({ ok: true, exists: true }) } })
    renderModal({ entries: [FILE_ENTRY, DIR_ENTRY] })
    expect(screen.queryByRole('heading', { name: 'Identity' })).toBeNull()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText(/5\.0 MB/)).toBeTruthy()
    expect(screen.getByText('1 folder, 1 file')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('2 of 2 mirrored')).toBeTruthy())
    expect(screen.queryByText('clip.mp4')).toBeNull()
    expect(screen.queryByText('Photos')).toBeNull()
  })

  it('reports mirroring as not applicable for a connection that does not mirror', async () => {
    renderModal({ entries: [FILE_ENTRY, DIR_ENTRY], connection: FLAT_CONN })
    await waitFor(() => expect(screen.getByText('Not applicable for this connection')).toBeTruthy())
  })
})

describe('PropertiesModal — dismissal', () => {
  it('calls onClose from the Close action', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
