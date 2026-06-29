import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import Thumbnail from './Thumbnail'

function setup(props = {}) {
  return render(
    <Thumbnail name="photo.jpg" remotePath="/media/photo.jpg" connectionId="c1" size="grid" modified={0} {...props} />
  )
}

describe('Thumbnail (image)', () => {
  it('does not use native lazy loading — the virtualizer is the lazy mechanism', () => {
    const { container } = setup()
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('loading')).not.toBe('lazy')
  })

  it('shows a shimmer skeleton until the image loads, then removes it', () => {
    const { container } = setup()
    expect(container.querySelector('[data-skeleton]')).toBeTruthy()
    fireEvent.load(container.querySelector('img'))
    expect(container.querySelector('[data-skeleton]')).toBeNull()
  })

  it('drops the skeleton and shows a fallback icon on error', () => {
    const { container } = setup()
    fireEvent.error(container.querySelector('img'))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-skeleton]')).toBeNull()
  })
})
