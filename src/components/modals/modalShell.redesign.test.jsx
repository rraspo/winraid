import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DeleteModal from './DeleteModal'
import BulkDeleteModal from './BulkDeleteModal'
import BulkMoveModal from './BulkMoveModal'
import MoveModal from './MoveModal'
import ConfirmModal from './ConfirmModal'

// Contract under test — every modal on the redesign shares one shell: a
// centered card on a dimmed backdrop that is a real dialog for assistive
// technology (role="dialog", aria-modal, named by its title), with the
// actions row at the bottom right and the confirming action styled from
// the accent (or the error token for destructive ones). Each modal keeps
// its existing props, copy and behavior.

const noop = () => {}

describe('modal shell', () => {
  it('DeleteModal is a dialog named by its title', () => {
    render(<DeleteModal target={{ name: 'a.jpg', path: '/photos/a.jpg', isDir: false }} onConfirm={noop} onCancel={noop} />)
    const dialog = screen.getByRole('dialog', { name: 'Delete file?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('BulkDeleteModal is a dialog named by its title', () => {
    render(<BulkDeleteModal count={2} names={['a.jpg', 'b.jpg']} onConfirm={noop} onCancel={noop} />)
    expect(screen.getByRole('dialog', { name: 'Delete 2 items?' })).toBeTruthy()
  })

  it('BulkMoveModal is a dialog named by its title', () => {
    render(<BulkMoveModal count={2} names={['a.jpg', 'b.jpg']} dest="/photos" onDestChange={noop} onConfirm={noop} onCancel={noop} currentPath="/photos" sftpCfg={null} />)
    expect(screen.getByRole('dialog', { name: 'Move 2 items' })).toBeTruthy()
  })

  it('MoveModal is a dialog named by its title', () => {
    render(<MoveModal target={{ name: 'a.jpg', path: '/photos/a.jpg', isDir: false }} sftpCfg={null} onConfirm={noop} onCancel={noop} />)
    expect(screen.getByRole('dialog', { name: 'Move / Rename' })).toBeTruthy()
  })

  it('ConfirmModal is a dialog named by its title', () => {
    render(<ConfirmModal remotePath="/mnt/user/other/file.txt" cfgRemotePath="/mnt/user/media" localFolder="C:\\sync" onConfirm={vi.fn()} onCancel={noop} />)
    expect(screen.getByRole('dialog', { name: 'Outside sync root' })).toBeTruthy()
  })
})
