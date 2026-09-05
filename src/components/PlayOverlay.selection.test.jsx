import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import PlayOverlay, { WALL_PAGE_SIZE } from './PlayOverlay'
import { createWinraidMock } from '../__mocks__/winraid'
import * as toast from '../services/toast'

// Contract under test — the play wall is an organizing surface: tiles can
// be selected and the selection deleted or moved without leaving Play, and
// the wall reflects every result the moment it completes.
//
// DOM contract the implementation must honor (on top of PlayOverlay.test):
//   - each tile keeps its <button aria-label="Open <basename>"> and gains a
//     sibling select control <button aria-label="Select <basename>"
//     aria-pressed="true|false">; a selected tile's Open button carries
//     data-selected="true"
//   - Ctrl+click on a tile toggles it, Shift+click selects the range from
//     the last anchor in wall order, plain click still opens the viewer;
//     Ctrl+A selects every walked tile; Escape clears the selection and
//     only closes Play when nothing is selected; the Delete key with a
//     selection opens the delete confirmation. None of these keys act
//     while the viewer is open.
//   - a bulk bar <div role="toolbar" aria-label="Selection"> exists only
//     while something is selected: it shows "<N> selected" and the buttons
//     "Move selected", "Delete selected", "Clear selection"; while an
//     operation runs it shows "Deleting <i> of <n>" / "Moving <i> of <n>"
//     and disables Move and Delete
//   - Delete uses BulkDeleteModal; Move uses MoveModal for one tile and
//     BulkMoveModal for several (destination defaults to the scan root,
//     Browse offered only with an sftpCfg prop)
//   - props gain sftpCfg; onMutated({ paths }) reports every touched path

vi.mock('react-image-crop', () => ({
  default: ({ children }) => <div data-testid="react-crop">{children}</div>,
}))
vi.mock('react-image-crop/dist/ReactCrop.css', () => ({}))

let onMediaFoundCb = null
let onMediaDoneCb  = null

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let savedIntersectionObserver
let savedResizeObserver

beforeEach(() => {
  savedIntersectionObserver = window.IntersectionObserver
  savedResizeObserver       = window.ResizeObserver
  window.IntersectionObserver     = IntersectionObserverStub
  window.ResizeObserver           = ResizeObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub
  globalThis.ResizeObserver       = ResizeObserverStub
})

afterEach(() => {
  window.IntersectionObserver     = savedIntersectionObserver
  window.ResizeObserver           = savedResizeObserver
  globalThis.IntersectionObserver = savedIntersectionObserver
  globalThis.ResizeObserver       = savedResizeObserver
  toast.clearAll()
  delete window.winraid
})

function setup({ recursive = true, remote = {} } = {}) {
  onMediaFoundCb = null
  onMediaDoneCb  = null
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockResolvedValue({ recursive, shuffle: false }) },
    remote: {
      mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
      mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
      onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => {} }),
      onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => {} }),
      onMediaError: vi.fn().mockReturnValue(() => {}),
      delete:       vi.fn().mockResolvedValue({ ok: true }),
      move:         vi.fn().mockResolvedValue({ ok: true }),
      ...remote,
    },
  })
}

const defaultProps = {
  connectionId: 'c1',
  path: '/photos',
  onClose: vi.fn(),
  remoteBasePath: '/photos',
  canServerEdit: true,
  onMutated: vi.fn(),
  sftpCfg: null,
}

function image(path) { return { path, size: 100, mtime: 0, type: 'image' } }

function emit(files) {
  act(() => { onMediaFoundCb?.({ files }) })
}

function finishScan(totalMatches) {
  act(() => { onMediaDoneCb?.({ totalMatches, durationMs: 10 }) })
}

async function mount(props = defaultProps) {
  const utils = render(<PlayOverlay {...props} />)
  await act(async () => {})
  return utils
}

// The wall is aria-hidden while the viewer covers it, so tile queries
// include hidden nodes: the tiles are still there, just not for assistive
// technology until the viewer closes.
function tile(name) {
  return screen.getByRole('button', { name: `Open ${name}`, hidden: true })
}

function tilePaths() {
  return screen.queryAllByRole('button', { name: /^Open /, hidden: true })
    .map((element) => element.getAttribute('aria-label').replace(/^Open /, ''))
}

function selectedNames() {
  return screen.queryAllByRole('button', { name: /^Open /, hidden: true })
    .filter((element) => element.getAttribute('data-selected') === 'true')
    .map((element) => element.getAttribute('aria-label').replace(/^Open /, ''))
}

function selectControl(name) {
  return screen.getByRole('button', { name: `Select ${name}`, hidden: true })
}

function bulkBar() {
  return screen.queryByRole('toolbar', { name: 'Selection' })
}

function viewer() {
  return screen.queryByTestId('play-viewer')
}

function ctrlClick(name) {
  fireEvent.click(tile(name), { ctrlKey: true })
}

function shiftClick(name) {
  fireEvent.click(tile(name), { shiftKey: true })
}

function pressKey(key, modifiers = {}) {
  fireEvent.keyDown(window, { key, ...modifiers })
}

function threeImages() {
  return [image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')]
}

function fourImages() {
  return [...threeImages(), image('/photos/d.jpg')]
}

async function mountWith(files, props = defaultProps, options = {}) {
  setup(options)
  await mount(props)
  emit(files)
  finishScan(files.length)
}

function toastMessages(type) {
  return toast.getSnapshot().filter((entry) => entry.type === type).map((entry) => entry.msg)
}

describe('PlayOverlay wall selection', () => {
  it('starts with nothing selected and no bulk bar; a plain click still opens the viewer', async () => {
    await mountWith(threeImages())
    expect(selectedNames()).toEqual([])
    expect(bulkBar()).toBeNull()
    fireEvent.click(tile('b.jpg'))
    await act(async () => {})
    expect(viewer()).toBeTruthy()
    expect(selectedNames()).toEqual([])
  })

  it('Ctrl+click toggles a tile without opening it and shows the bulk bar', async () => {
    await mountWith(threeImages())
    ctrlClick('a.jpg')
    expect(viewer()).toBeNull()
    expect(selectedNames()).toEqual(['a.jpg'])
    expect(selectControl('a.jpg').getAttribute('aria-pressed')).toBe('true')
    expect(within(bulkBar()).getByText('1 selected')).toBeTruthy()
    ctrlClick('a.jpg')
    expect(selectedNames()).toEqual([])
    expect(bulkBar()).toBeNull()
  })

  it('the select control toggles a tile without opening it', async () => {
    await mountWith(threeImages())
    expect(selectControl('b.jpg').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(selectControl('b.jpg'))
    expect(viewer()).toBeNull()
    expect(selectedNames()).toEqual(['b.jpg'])
    fireEvent.click(selectControl('c.jpg'))
    expect(selectedNames()).toEqual(['b.jpg', 'c.jpg'])
    expect(within(bulkBar()).getByText('2 selected')).toBeTruthy()
  })

  it('Shift+click selects the range from the last anchor in wall order', async () => {
    await mountWith(fourImages())
    ctrlClick('b.jpg')
    shiftClick('d.jpg')
    expect(selectedNames()).toEqual(['b.jpg', 'c.jpg', 'd.jpg'])
  })

  it('Shift+click with no anchor selects from the first tile', async () => {
    await mountWith(fourImages())
    shiftClick('c.jpg')
    expect(selectedNames()).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  it('Ctrl+A selects every walked tile and only the walked ones', async () => {
    setup()
    await mount()
    emit(Array.from({ length: WALL_PAGE_SIZE + 6 }, (_, i) => image(`/photos/${String(i).padStart(4, '0')}.jpg`)))
    pressKey('a', { ctrlKey: true })
    expect(selectedNames()).toHaveLength(WALL_PAGE_SIZE)
    expect(within(bulkBar()).getByText(`${WALL_PAGE_SIZE} selected`)).toBeTruthy()
  })

  it('Escape clears the selection first and only closes Play when nothing is selected', async () => {
    const onClose = vi.fn()
    await mountWith(threeImages(), { ...defaultProps, onClose })
    ctrlClick('a.jpg')
    pressKey('Escape')
    expect(selectedNames()).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
    pressKey('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the Clear selection button empties the selection', async () => {
    await mountWith(threeImages())
    ctrlClick('a.jpg')
    ctrlClick('b.jpg')
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Clear selection' }))
    expect(selectedNames()).toEqual([])
    expect(bulkBar()).toBeNull()
  })

  it('the selection survives opening and closing the viewer', async () => {
    await mountWith(threeImages())
    ctrlClick('a.jpg')
    fireEvent.click(tile('b.jpg'))
    await act(async () => {})
    expect(viewer()).toBeTruthy()
    pressKey('Escape')
    await act(async () => {})
    expect(viewer()).toBeNull()
    expect(selectedNames()).toEqual(['a.jpg'])
  })

  it('selection keys do nothing while the viewer is open', async () => {
    const onClose = vi.fn()
    await mountWith(threeImages(), { ...defaultProps, onClose })
    fireEvent.click(tile('b.jpg'))
    await act(async () => {})
    pressKey('a', { ctrlKey: true })
    pressKey('Delete')
    expect(selectedNames()).toEqual([])
    expect(screen.queryByText(/^Delete \d+ items?\?$/)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('rescoping through a breadcrumb clears the selection', async () => {
    await mountWith(threeImages())
    ctrlClick('a.jpg')
    fireEvent.click(screen.getByRole('button', { name: '/' }))
    await act(async () => {})
    expect(selectedNames()).toEqual([])
    expect(bulkBar()).toBeNull()
  })

  it('toggling recursive clears the selection', async () => {
    await mountWith(threeImages())
    ctrlClick('a.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recursive scan' }))
    await act(async () => {})
    expect(selectedNames()).toEqual([])
    expect(bulkBar()).toBeNull()
  })
})

describe('PlayOverlay wall bulk delete', () => {
  function confirmBulkDelete() {
    return act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Delete \d+ items?$/ }))
    })
  }

  it('Delete selected asks for confirmation listing the names, deleting nothing yet; Cancel keeps everything', async () => {
    await mountWith(threeImages())
    ctrlClick('a.jpg')
    ctrlClick('c.jpg')
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Delete selected' }))
    expect(screen.getByText('Delete 2 items?')).toBeTruthy()
    expect(screen.getByText('a.jpg', { selector: 'li' })).toBeTruthy()
    expect(screen.getByText('c.jpg', { selector: 'li' })).toBeTruthy()
    expect(window.winraid.remote.delete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete 2 items?')).toBeNull()
    expect(tilePaths()).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(selectedNames()).toEqual(['a.jpg', 'c.jpg'])
  })

  it('the Delete key opens the confirmation only when something is selected', async () => {
    await mountWith(threeImages())
    pressKey('Delete')
    expect(screen.queryByText(/^Delete \d+ items?\?$/)).toBeNull()
    ctrlClick('b.jpg')
    pressKey('Delete')
    expect(screen.getByText('Delete 1 item?')).toBeTruthy()
  })

  it('confirming deletes each file in wall order, drops the tiles, clears the selection and keeps Play open', async () => {
    const onMutated = vi.fn()
    const onClose   = vi.fn()
    await mountWith(threeImages(), { ...defaultProps, onMutated, onClose })
    ctrlClick('c.jpg')
    ctrlClick('a.jpg')
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Delete selected' }))
    await confirmBulkDelete()
    expect(window.winraid.remote.delete.mock.calls).toEqual([
      ['c1', '/photos/a.jpg', false],
      ['c1', '/photos/c.jpg', false],
    ])
    expect(window.winraid.cache.invalidateFile).toHaveBeenCalledWith('c1', '/photos/a.jpg')
    expect(window.winraid.cache.invalidateFile).toHaveBeenCalledWith('c1', '/photos/c.jpg')
    expect(tilePaths()).toEqual(['b.jpg'])
    expect(selectedNames()).toEqual([])
    expect(bulkBar()).toBeNull()
    expect(onMutated).toHaveBeenCalledWith({ paths: ['/photos/a.jpg', '/photos/c.jpg'] })
    expect(onClose).not.toHaveBeenCalled()
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
    expect(toastMessages('success')).toContain('Deleted 2 items')
  })

  it('a failed file keeps its tile and stays selected while the rest go; the toast reports both counts', async () => {
    const onMutated = vi.fn()
    await mountWith(threeImages(), { ...defaultProps, onMutated }, {
      remote: {
        delete: vi.fn().mockImplementation((_connectionId, remotePath) =>
          Promise.resolve(remotePath === '/photos/b.jpg' ? { ok: false, error: 'Permission denied' } : { ok: true })),
      },
    })
    ctrlClick('a.jpg')
    ctrlClick('b.jpg')
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Delete selected' }))
    await confirmBulkDelete()
    expect(tilePaths()).toEqual(['b.jpg', 'c.jpg'])
    expect(selectedNames()).toEqual(['b.jpg'])
    expect(onMutated).toHaveBeenCalledWith({ paths: ['/photos/a.jpg'] })
    expect(toastMessages('error')).toContain('Deleted 1, failed 1')
  })

  it('shows progress and disables Move and Delete while the deletes run', async () => {
    let releaseFirst
    const deleteMock = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve({ ok: true }) }))
      .mockResolvedValue({ ok: true })
    await mountWith(threeImages(), defaultProps, { remote: { delete: deleteMock } })
    ctrlClick('a.jpg')
    ctrlClick('b.jpg')
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Delete selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 items' }))
    await act(async () => {})
    expect(within(bulkBar()).getByText('Deleting 1 of 2')).toBeTruthy()
    expect(within(bulkBar()).getByRole('button', { name: 'Delete selected' }).disabled).toBe(true)
    expect(within(bulkBar()).getByRole('button', { name: 'Move selected' }).disabled).toBe(true)
    await act(async () => { releaseFirst() })
    await act(async () => {})
    expect(bulkBar()).toBeNull()
    expect(tilePaths()).toEqual(['c.jpg'])
  })
})

describe('PlayOverlay wall bulk move', () => {
  function openMove() {
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Move selected' }))
  }

  function setDestination(value) {
    fireEvent.change(screen.getByDisplayValue('/photos'), { target: { value } })
  }

  function confirmMove() {
    return act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    })
  }

  it('Move selected with several tiles opens the bulk move dialog at the scan root, with Browse only over SFTP', async () => {
    await mountWith(threeImages())
    ctrlClick('a.jpg')
    ctrlClick('b.jpg')
    openMove()
    expect(screen.getByText('Move 2 items')).toBeTruthy()
    expect(screen.getByDisplayValue('/photos')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Browse' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Move 2 items')).toBeNull()
    expect(window.winraid.remote.move).not.toHaveBeenCalled()
  })

  it('offers Browse in the move dialog when an sftpCfg is provided', async () => {
    await mountWith(threeImages(), { ...defaultProps, sftpCfg: { host: 'nas.local', username: 'user' } })
    ctrlClick('a.jpg')
    ctrlClick('b.jpg')
    openMove()
    expect(screen.getByRole('button', { name: 'Browse' })).toBeTruthy()
  })

  it('moving out of the scan scope removes the tiles and reports every path', async () => {
    const onMutated = vi.fn()
    await mountWith(threeImages(), { ...defaultProps, onMutated })
    ctrlClick('a.jpg')
    ctrlClick('c.jpg')
    openMove()
    setDestination('/archive')
    await confirmMove()
    expect(window.winraid.remote.move.mock.calls).toEqual([
      ['c1', '/photos/a.jpg', '/archive/a.jpg'],
      ['c1', '/photos/c.jpg', '/archive/c.jpg'],
    ])
    expect(tilePaths()).toEqual(['b.jpg'])
    expect(selectedNames()).toEqual([])
    expect(bulkBar()).toBeNull()
    expect(onMutated).toHaveBeenCalledTimes(1)
    const reported = onMutated.mock.calls[0][0].paths
    expect(reported).toHaveLength(4)
    expect(reported).toEqual(expect.arrayContaining(['/photos/a.jpg', '/archive/a.jpg', '/photos/c.jpg', '/archive/c.jpg']))
    expect(toastMessages('success')).toContain('Moved 2 items to /archive')
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
  })

  it('moving inside a recursive scan keeps the tiles with their new paths', async () => {
    await mountWith(threeImages())
    ctrlClick('a.jpg')
    ctrlClick('b.jpg')
    openMove()
    setDestination('/photos/keep')
    await confirmMove()
    expect(tilePaths()).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(tile('a.jpg').querySelector('img').getAttribute('src')).toContain('/photos/keep/a.jpg')
    expect(tile('b.jpg').querySelector('img').getAttribute('src')).toContain('/photos/keep/b.jpg')
    expect(selectedNames()).toEqual([])
  })

  it('moving into a subfolder of a flat scan removes the tiles', async () => {
    await mountWith(threeImages(), defaultProps, { recursive: false })
    ctrlClick('a.jpg')
    ctrlClick('b.jpg')
    openMove()
    setDestination('/photos/keep')
    await confirmMove()
    expect(tilePaths()).toEqual(['c.jpg'])
  })

  it('a single selected tile opens the rename dialog and a rename updates the tile in place', async () => {
    const onMutated = vi.fn()
    await mountWith(threeImages(), { ...defaultProps, onMutated })
    ctrlClick('b.jpg')
    openMove()
    expect(screen.getByText('Move / Rename')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'renamed' } })
    await confirmMove()
    expect(window.winraid.remote.move).toHaveBeenCalledWith('c1', '/photos/b.jpg', '/photos/renamed.jpg')
    expect(tilePaths()).toEqual(['a.jpg', 'renamed.jpg', 'c.jpg'])
    expect(onMutated).toHaveBeenCalledWith({ paths: ['/photos/b.jpg', '/photos/renamed.jpg'] })
    expect(toastMessages('success')).toContain('Moved to /photos/renamed.jpg')
  })

  it('a failed move keeps the tile selected and reports the error', async () => {
    const onMutated = vi.fn()
    await mountWith(threeImages(), { ...defaultProps, onMutated }, {
      remote: { move: vi.fn().mockResolvedValue({ ok: false, error: 'Destination exists' }) },
    })
    ctrlClick('a.jpg')
    ctrlClick('b.jpg')
    openMove()
    setDestination('/archive')
    await confirmMove()
    expect(tilePaths()).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(selectedNames()).toEqual(['a.jpg', 'b.jpg'])
    expect(onMutated).not.toHaveBeenCalled()
    expect(toastMessages('error')).toContain('Moved 0, failed 2')
  })
})
