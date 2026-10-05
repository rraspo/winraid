import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DeleteModal from './DeleteModal'
import BulkDeleteModal from './BulkDeleteModal'

// Contract under test — the delete dialog tells the truth about where the
// file is going.
//
// A connection with a trash folder moves deleted items into it, where they
// can be restored; one without deletes them for good. The dialog is the last
// thing the user reads before the file goes, so it has to say which of the
// two is about to happen. The caller knows the connection and passes
// `trashed`; when it is absent the delete is permanent, because promising a
// trash that does not exist is the dangerous mistake.

const FILE = { name: 'a.jpg', path: '/mnt/user/media/a.jpg', isDir: false }
const FOLDER = { name: 'album', path: '/mnt/user/media/album', isDir: true }

describe('the single delete dialog', () => {
  it('says the item moves to the trash when the connection has one', () => {
    render(<DeleteModal target={FILE} trashed onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveTextContent(/trash/i)
    expect(dialog).not.toHaveTextContent(/permanently|cannot be undone/i)
    expect(screen.getByRole('button', { name: /move to trash/i })).toBeInTheDocument()
  })

  it('says a folder and its contents move to the trash', () => {
    render(<DeleteModal target={FOLDER} trashed onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveTextContent(/trash/i)
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/permanently/i)
  })

  it('says the delete is permanent when the connection has no trash', () => {
    render(<DeleteModal target={FILE} trashed={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveTextContent(/permanently/i)
    expect(screen.queryByRole('button', { name: /move to trash/i })).toBeNull()
  })

  it('assumes permanent when nobody said otherwise', () => {
    render(<DeleteModal target={FILE} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveTextContent(/permanently/i)
  })
})

describe('the bulk delete dialog', () => {
  it('says the items move to the trash when the connection has one', () => {
    render(<BulkDeleteModal count={2} names={['a.jpg', 'b.jpg']} trashed onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveTextContent(/trash/i)
    expect(dialog).not.toHaveTextContent(/permanently|cannot be undone/i)
    expect(screen.getByRole('button', { name: /move 2 items to trash/i })).toBeInTheDocument()
  })

  it('says the delete is permanent when the connection has no trash', () => {
    render(<BulkDeleteModal count={2} names={['a.jpg', 'b.jpg']} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveTextContent(/permanently/i)
    expect(screen.queryByRole('button', { name: /to trash/i })).toBeNull()
  })
})
