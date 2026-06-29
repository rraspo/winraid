import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ConnectionView from './ConnectionView'
import { createWinraidMock } from '../__mocks__/winraid'

const NAME = /keep empty folders/i

function baseConn(overrides = {}) {
  return {
    id: 'conn1', name: 'NAS', icon: null, type: 'sftp',
    sftp: { host: 'nas.local', port: 22, username: 'u', password: '', keyPath: '', remotePath: '/media' },
    smb: { host: '', share: '', username: '', password: '', remotePath: '' },
    localFolder: 'C:\\downloads', operation: 'copy', folderMode: 'flat',
    extensions: [], ignoredExtensions: [],
    ...overrides,
  }
}

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockResolvedValue([]),   // connections list for save / overlap check
      set: vi.fn().mockResolvedValue(undefined),
    },
  })
})

afterEach(() => { delete window.winraid })

describe('ConnectionView — Keep empty folders', () => {
  it('keeps the option mounted but disabled for flat and mirror modes', async () => {
    const { rerender } = render(
      <ConnectionView existing={baseConn({ folderMode: 'flat' })} onSave={() => {}} onClose={() => {}} />
    )
    await act(async () => {})
    // Collapsed reveal is aria-hidden, so query with hidden: true.
    expect(screen.getByRole('checkbox', { name: NAME, hidden: true }).disabled).toBe(true)

    rerender(
      <ConnectionView existing={baseConn({ folderMode: 'mirror' })} onSave={() => {}} onClose={() => {}} />
    )
    await act(async () => {})
    expect(screen.getByRole('checkbox', { name: NAME, hidden: true }).disabled).toBe(true)
  })

  it('enables the option, unchecked by default, for mirror_clean', async () => {
    render(
      <ConnectionView existing={baseConn({ folderMode: 'mirror_clean' })} onSave={() => {}} onClose={() => {}} />
    )
    await act(async () => {})
    const box = screen.getByRole('checkbox', { name: NAME })
    expect(box.disabled).toBe(false)
    expect(box.checked).toBe(false)
  })

  it('reflects an existing keepEmptyDirs:true connection as checked', async () => {
    render(
      <ConnectionView existing={baseConn({ folderMode: 'mirror_clean', keepEmptyDirs: true })} onSave={() => {}} onClose={() => {}} />
    )
    await act(async () => {})
    expect(screen.getByRole('checkbox', { name: NAME }).checked).toBe(true)
  })

  it('persists keepEmptyDirs into the saved connection when toggled on', async () => {
    const onSave = vi.fn()
    render(
      <ConnectionView existing={baseConn({ folderMode: 'mirror_clean' })} onSave={onSave} onClose={() => {}} />
    )
    await act(async () => {})

    fireEvent.click(screen.getByRole('checkbox', { name: NAME }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
    })

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ keepEmptyDirs: true }))
    expect(window.winraid.config.set).toHaveBeenCalledWith(
      'connections',
      expect.arrayContaining([expect.objectContaining({ id: 'conn1', keepEmptyDirs: true })]),
    )
  })
})
