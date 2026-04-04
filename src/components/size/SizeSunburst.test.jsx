import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SizeSunburst from './SizeSunburst'

const TREE = {
  name: 'data',
  path: '/mnt/data',
  sizeKb: 2_100_000,
  children: [
    { name: 'Movies', path: '/mnt/data/Movies', sizeKb: 1_260_000, children: [] },
    { name: 'Photos', path: '/mnt/data/Photos', sizeKb: 630_000,   children: [] },
    { name: 'Music',  path: '/mnt/data/Music',  sizeKb: 210_000,   children: [] },
  ],
}

describe('SizeSunburst', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <SizeSunburst data={TREE} width={300} height={300} focusedPath={null} />
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders arc paths for each child', () => {
    const { container } = render(
      <SizeSunburst data={TREE} width={300} height={300} focusedPath={null} />
    )
    const paths = container.querySelectorAll('path')
    // At minimum one path per child (Movies, Photos, Music)
    expect(paths.length).toBeGreaterThanOrEqual(3)
  })

  it('renders total size text in the center hole', () => {
    render(<SizeSunburst data={TREE} width={300} height={300} focusedPath={null} />)
    // sizeKb=2_100_000 → 2.00 GB (2100000*1024 bytes ≈ 2.00 GB)
    expect(screen.getByText(/GB/)).toBeInTheDocument()
  })

  it('calls onArcClick with the node data when an arc is clicked', () => {
    const onArcClick = vi.fn()
    const { container } = render(
      <SizeSunburst data={TREE} width={300} height={300} focusedPath={null} onArcClick={onArcClick} />
    )
    const paths = container.querySelectorAll('path[data-path]')
    expect(paths.length).toBeGreaterThan(0)
    fireEvent.click(paths[0])
    expect(onArcClick).toHaveBeenCalled()
  })

  it('calls onCenterClick when center circle is clicked', () => {
    const onCenterClick = vi.fn()
    const { container } = render(
      <SizeSunburst data={TREE} width={300} height={300} focusedPath={null} onCenterClick={onCenterClick} />
    )
    const circle = container.querySelector('circle[data-role="center"]')
    expect(circle).not.toBeNull()
    fireEvent.click(circle)
    expect(onCenterClick).toHaveBeenCalled()
  })
})
