import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import MoveModal from './MoveModal'

afterEach(cleanup)

describe('MoveModal — extension as a separate field', () => {
  it('splits a file name into stem and extension fields', () => {
    render(
      <MoveModal
        target={{ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByLabelText('Name').value).toBe('photo')
    expect(screen.getByLabelText('Extension').value).toBe('.jpg')
  })

  it('reassembles stem + extension on confirm', () => {
    const onConfirm = vi.fn()
    render(
      <MoveModal
        target={{ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'sunset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(onConfirm).toHaveBeenCalledWith('/media/photo.jpg', '/media/sunset.jpg')
  })

  it('does not show an extension field for directories', () => {
    render(
      <MoveModal
        target={{ name: 'My Folder', path: '/media/My Folder', isDir: true }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByLabelText('Name').value).toBe('My Folder')
    expect(screen.queryByLabelText('Extension')).toBeNull()
  })

  it('uses a single field (no extension) for a dotfile', () => {
    render(
      <MoveModal
        target={{ name: '.htaccess', path: '/media/.htaccess', isDir: false }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByLabelText('Name').value).toBe('.htaccess')
    expect(screen.queryByLabelText('Extension')).toBeNull()
  })

  it('uses a single field (no extension) for multi-dot names', () => {
    render(
      <MoveModal
        target={{ name: 'archive.tar.gz', path: '/media/archive.tar.gz', isDir: false }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByLabelText('Name').value).toBe('archive.tar.gz')
    expect(screen.queryByLabelText('Extension')).toBeNull()
  })

  it('renames a multi-dot name through the single field', () => {
    const onConfirm = vi.fn()
    render(
      <MoveModal
        target={{ name: 'archive.tar.gz', path: '/media/archive.tar.gz', isDir: false }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'backup.tar.gz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(onConfirm).toHaveBeenCalledWith('/media/archive.tar.gz', '/media/backup.tar.gz')
  })
})
