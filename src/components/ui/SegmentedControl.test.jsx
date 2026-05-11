import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SegmentedControl from './SegmentedControl'

const opts = [
  { value: 'jpeg', label: 'JPEG', desc: 'Smallest files for photo-like frames.' },
  { value: 'png',  label: 'PNG',  desc: 'Lossless. Larger files.' },
  { value: 'webp', label: 'WebP', desc: 'Smaller than JPEG.' },
]

describe('SegmentedControl', () => {
  it('renders one button per option with role="radio"', () => {
    render(<SegmentedControl options={opts} value="jpeg" onChange={() => {}} />)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('renders the container with role="radiogroup"', () => {
    render(<SegmentedControl options={opts} value="jpeg" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
  })

  it('renders the optional label above the bar', () => {
    render(<SegmentedControl label="VIDEO FORMAT" options={opts} value="jpeg" onChange={() => {}} />)
    expect(screen.getByText('VIDEO FORMAT')).toBeInTheDocument()
  })

  it('marks the selected option with aria-checked="true" and others with "false"', () => {
    render(<SegmentedControl options={opts} value="png" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'JPEG' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: 'PNG'  }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'WebP' }).getAttribute('aria-checked')).toBe('false')
  })

  it('shows the active option’s desc below the bar', () => {
    render(<SegmentedControl options={opts} value="jpeg" onChange={() => {}} />)
    expect(screen.getByText('Smallest files for photo-like frames.')).toBeInTheDocument()
    expect(screen.queryByText('Lossless. Larger files.')).not.toBeInTheDocument()
  })

  it('renders no desc element when the active option has no desc', () => {
    const optsNoDesc = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]
    const { container } = render(<SegmentedControl options={optsNoDesc} value="a" onChange={() => {}} />)
    expect(container.textContent).toBe('AB')
  })

  it('fires onChange with the clicked option’s value', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={opts} value="jpeg" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'PNG' }))
    expect(onChange).toHaveBeenCalledWith('png')
  })

  it('does not fire onChange when clicking the already-selected option', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={opts} value="jpeg" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'JPEG' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('arrow-Right moves selection to the next option', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={opts} value="jpeg" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'JPEG' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('png')
  })

  it('arrow-Left moves selection to the previous option', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={opts} value="webp" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'WebP' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith('png')
  })

  it('arrow-Down moves selection to the next option', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={opts} value="jpeg" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'JPEG' }), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenCalledWith('png')
  })

  it('arrow-Up moves selection to the previous option', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={opts} value="webp" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'WebP' }), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('png')
  })

  it('arrow-Right from last option wraps to first', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={opts} value="webp" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'WebP' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('jpeg')
  })

  it('arrow-Left from first option wraps to last', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={opts} value="jpeg" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'JPEG' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith('webp')
  })

  it('only the selected option has tabIndex 0 (roving tabindex)', () => {
    render(<SegmentedControl options={opts} value="png" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'JPEG' }).tabIndex).toBe(-1)
    expect(screen.getByRole('radio', { name: 'PNG'  }).tabIndex).toBe(0)
    expect(screen.getByRole('radio', { name: 'WebP' }).tabIndex).toBe(-1)
  })

  it('uses aria-label as the radiogroup accessible name when no visible label is given', () => {
    render(<SegmentedControl aria-label="Picker" options={opts} value="jpeg" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'Picker' })).toBeTruthy()
  })

  it('uses the visible label text as the radiogroup accessible name when label is given', () => {
    render(<SegmentedControl label="VIDEO FORMAT" options={opts} value="jpeg" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'VIDEO FORMAT' })).toBeTruthy()
  })
})
