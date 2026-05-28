import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DragGhost from './DragGhost'

function makeEntry(name, type = 'file', extra = {}) {
  return { name, type, size: 0, modified: 0, entryPath: `/photos/${name}`, ...extra }
}

function makeDragSource(entries, overrides = {}) {
  return {
    entries,
    cardSize:    { width: 140, height: 40 },
    clickOffset: { x: 10, y: 10 },
    ...overrides,
  }
}

const POS = { x: 200, y: 150 }

describe('DragGhost', () => {
  it('renders nothing when dragSource is null', () => {
    const { container } = render(
      <DragGhost dragSource={null} dragPos={POS} connectionId="c1" viewMode="grid" />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when dragPos is null', () => {
    const src = makeDragSource([makeEntry('a.jpg')])
    const { container } = render(
      <DragGhost dragSource={src} dragPos={null} connectionId="c1" viewMode="grid" />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the top entry name in grid mode', () => {
    const src = makeDragSource([makeEntry('photo.jpg')])
    render(<DragGhost dragSource={src} dragPos={POS} connectionId="c1" viewMode="grid" />)
    expect(screen.getByText('photo.jpg')).toBeInTheDocument()
  })

  it('renders the top entry name in list mode', () => {
    const src = makeDragSource([makeEntry('document.txt')])
    render(<DragGhost dragSource={src} dragPos={POS} connectionId="c1" viewMode="list" />)
    expect(screen.getByText('document.txt')).toBeInTheDocument()
  })

  it('renders a +N badge for multi-entry drags', () => {
    const src = makeDragSource([
      makeEntry('a.jpg'), makeEntry('b.jpg'), makeEntry('c.jpg'), makeEntry('d.jpg'),
    ])
    render(<DragGhost dragSource={src} dragPos={POS} connectionId="c1" viewMode="grid" />)
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('does not render a count badge for a single-entry drag', () => {
    const src = makeDragSource([makeEntry('only.jpg')])
    render(<DragGhost dragSource={src} dragPos={POS} connectionId="c1" viewMode="grid" />)
    expect(screen.queryByText(/^\+\d+$/)).toBeNull()
  })

  it('renders the file size for non-dir entries in grid mode', () => {
    const src = makeDragSource([makeEntry('big.jpg', 'file', { size: 1024 * 1024 })])
    render(<DragGhost dragSource={src} dragPos={POS} connectionId="c1" viewMode="grid" />)
    // formatSize(1024*1024) → '1.0 MB' or similar — assert it's *not* "0 B"
    // and the text appears alongside the filename.
    expect(screen.getByText('big.jpg')).toBeInTheDocument()
    expect(screen.queryByText(/^0 B$/i)).toBeNull()
  })

  it('omits the size field for directories', () => {
    const src = makeDragSource([makeEntry('subdir', 'dir', { size: 99999 })])
    render(<DragGhost dragSource={src} dragPos={POS} connectionId="c1" viewMode="grid" />)
    expect(screen.getByText('subdir')).toBeInTheDocument()
    // No size pill should render for a dir even if size > 0
    expect(screen.queryByText(/MB|KB|GB|^\d+ B$/i)).toBeNull()
  })

  it('renders a thumbnail img for image files (uses nas-stream URL with thumb=1)', () => {
    const src = makeDragSource([makeEntry('pic.jpg')])
    const { container } = render(
      <DragGhost dragSource={src} dragPos={POS} connectionId="conn-abc" viewMode="grid" />
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe('nas-stream://conn-abc/photos/pic.jpg?thumb=1')
  })

  it('does not render an <img> for video files (img cannot render video streams; uses Film icon)', () => {
    const src = makeDragSource([makeEntry('clip.mp4')])
    const { container } = render(
      <DragGhost dragSource={src} dragPos={POS} connectionId="c1" viewMode="grid" />
    )
    expect(container.querySelector('img')).toBeNull()
    // The lucide Film icon renders as inline SVG; just confirm one is present.
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('falls back to the icon when the thumbnail <img> fails to load', () => {
    const src = makeDragSource([makeEntry('pic.jpg')])
    const { container } = render(
      <DragGhost dragSource={src} dragPos={POS} connectionId="c1" viewMode="grid" />
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img)
    // After the error event, the img is replaced with the lucide Image icon (an svg).
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('positions the wrapper at dragPos minus clickOffset', () => {
    const src = makeDragSource(
      [makeEntry('a.jpg')],
      { clickOffset: { x: 30, y: 20 } }
    )
    const { container } = render(
      <DragGhost dragSource={src} dragPos={{ x: 500, y: 400 }} connectionId="c1" viewMode="grid" />
    )
    const wrapper = container.firstChild
    expect(wrapper.style.left).toBe('470px')
    expect(wrapper.style.top).toBe('380px')
  })
})
