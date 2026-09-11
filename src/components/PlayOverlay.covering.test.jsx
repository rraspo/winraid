import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import PlayOverlay from './PlayOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — the play wall is opened two ways and has to sit
// differently in each.
//
// From the nav rail it IS the screen: it takes the content area beside the
// rail, the way Browse or Settings do. From the Play button inside the
// browser it is opened over the file list instead, and there it has to
// cover, the way Quick Look does. The wall became a screen and both call
// sites got the screen behaviour, so opening it from the browser left it
// sharing the column with the toolbar and the list above it, drawn at a
// fraction of the height with the file list still showing underneath.
//
// DOM contract:
//   - given `covering`, the wall carries data-cover="true", which is what
//     the stylesheet keys the covering layout off
//   - without it the wall carries no such marker and stays an ordinary
//     flex child of the content area
//   - the wall's own Fullscreen control is unrelated to this and keeps
//     working in either case

const noop = () => {}

beforeEach(() => {
  window.winraid = createWinraidMock({
    remote: {
      mediaScan:    vi.fn(async () => ({ ok: true })),
      mediaCancel:  vi.fn(async () => ({ ok: true })),
      onMediaFound: vi.fn(() => () => {}),
      onMediaDone:  vi.fn(() => () => {}),
      onMediaError: vi.fn(() => () => {}),
      list:         vi.fn(async () => ({ ok: true, entries: [] })),
    },
  })
})

afterEach(() => { delete window.winraid })

async function mount(props = {}) {
  render(
    <PlayOverlay
      connectionId="c1"
      path="/mnt/user/media"
      onClose={noop}
      remoteBasePath="/mnt/user/media"
      {...props}
    />,
  )
  await act(async () => {})
  return screen.getByRole('region', { name: 'Play' })
}

describe('PlayOverlay presentation', () => {
  it('covers what is beneath it when opened over the browser', async () => {
    const region = await mount({ covering: true })
    expect(region.getAttribute('data-cover')).toBe('true')
  })

  it('is an ordinary screen when opened from the nav rail', async () => {
    const region = await mount()
    expect(region.getAttribute('data-cover')).toBeNull()
  })
})
