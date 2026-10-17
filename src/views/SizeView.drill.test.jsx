import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import * as toast from '../services/toast'
import SizeView from './SizeView'

// Legend rows are clickable for every child, files included. A drill into a
// file (or a symlink listed as one) makes the main process readdir a path
// that is not a directory, which the server answers with "No such file".

const CONN = { id: 'conn-1', name: 'Atlas', type: 'sftp', sftp: { host: 'nas.local', remotePath: '/' } }
const TREE = {
  name: '/', path: '/', sizeKb: 300,
  children: [
    { name: 'srv', path: '/srv', type: 'dir', sizeKb: 200, children: [] },
    { name: 'vmlinuz', path: '/vmlinuz', type: 'file', sizeKb: 60, children: [] },
    { name: 'legacy', path: '/legacy', sizeKb: 40, children: [] },
  ],
}

beforeEach(() => {
  window.winraid = createWinraidMock()
  window.winraid.remote.sizeLoadCache.mockResolvedValue({ tree: structuredClone(TREE), scanMeta: { totalFolders: 3, elapsedMs: 10, scannedAt: Date.now() } })
})
afterEach(() => { delete window.winraid; toast.clearAll() })

async function clickRow(name) {
  render(<SizeView connectionId="conn-1" connection={CONN} />)
  const row = (await screen.findByText(name)).closest('div')
  fireEvent.click(row)
}

describe('SizeView — drilling from the legend', () => {
  it('drills into a folder', async () => {
    window.winraid.remote.sizeScanSubtree.mockResolvedValue({ ok: true })
    await clickRow('srv')
    expect(window.winraid.remote.sizeScanSubtree).toHaveBeenCalledWith('conn-1', '/srv')
  })

  it('does not drill into a file', async () => {
    await clickRow('vmlinuz')
    expect(window.winraid.remote.sizeScanSubtree).not.toHaveBeenCalled()
  })

  it('still drills into an entry from an older cached scan that carries no type', async () => {
    window.winraid.remote.sizeScanSubtree.mockResolvedValue({ ok: true })
    await clickRow('legacy')
    expect(window.winraid.remote.sizeScanSubtree).toHaveBeenCalledWith('conn-1', '/legacy')
  })

  it('tells the user when the folder can no longer be read, instead of failing silently', async () => {
    window.winraid.remote.sizeScanSubtree.mockResolvedValue({ ok: false, error: 'No such file' })
    await clickRow('srv')
    await waitFor(() => {
      const messages = toast.getSnapshot().map((entry) => entry.msg)
      expect(messages.some((message) => /srv/.test(message) && /No such file/.test(message))).toBe(true)
    })
  })

  it('tells the user when the request itself fails', async () => {
    window.winraid.remote.sizeScanSubtree.mockRejectedValue(new Error('channel closed'))
    await clickRow('srv')
    await waitFor(() => expect(toast.getSnapshot().length).toBe(1))
  })
})
