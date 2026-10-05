import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import Tooltip from './Tooltip'
import { resetTooltipWarmthForTests } from './tooltipWarmth'

function advance(ms) {
  act(() => { vi.advanceTimersByTime(ms) })
}

// Contract under test — cold delay, then instant while warm.
//
// A flat delay short enough to feel responsive on one deliberate hover is
// short enough to strobe across a dense row of icon-only buttons. First
// hover anywhere pays a 600ms cold delay; once a tooltip has shown, hovering
// a sibling control within ~1.5s of the last one closing shows instantly;
// after ~1.5s of no hover the window expires and the next hover goes cold
// again. Hiding is always immediate, in every state.

function hoverSpan(name) {
  const anchor = screen.getByText(name).closest('.anchor')
  fireEvent.mouseEnter(anchor)
  return anchor
}

beforeEach(() => {
  resetTooltipWarmthForTests()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Tooltip — cold delay', () => {
  it('shows nothing immediately on hover', () => {
    render(<Tooltip tip="Cut"><span>Target</span></Tooltip>)
    hoverSpan('Target')
    expect(screen.queryByText('Cut')).toBeNull()
  })

  it('appears after the 600ms cold delay', () => {
    render(<Tooltip tip="Cut"><span>Target</span></Tooltip>)
    hoverSpan('Target')
    advance(599)
    expect(screen.queryByText('Cut')).toBeNull()
    advance(1)
    expect(screen.getByText('Cut')).toBeTruthy()
  })

  it('shows nothing and leaves no pending timer when the pointer leaves before the delay elapses', () => {
    render(<Tooltip tip="Cut"><span>Target</span></Tooltip>)
    const anchor = hoverSpan('Target')
    advance(300)
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByText('Cut')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    advance(1000)
    expect(screen.queryByText('Cut')).toBeNull()
  })

  it('leaves no pending timer when unmounted mid-delay', () => {
    const { unmount } = render(<Tooltip tip="Cut"><span>Target</span></Tooltip>)
    hoverSpan('Target')
    advance(300)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Tooltip — hide is always immediate', () => {
  it('hides immediately from mid-delay (cold, not yet visible)', () => {
    render(<Tooltip tip="Cut"><span>Target</span></Tooltip>)
    const anchor = hoverSpan('Target')
    advance(300)
    fireEvent.mouseLeave(anchor)
    advance(600)
    expect(screen.queryByText('Cut')).toBeNull()
  })

  it('hides immediately once shown', () => {
    render(<Tooltip tip="Cut"><span>Target</span></Tooltip>)
    const anchor = hoverSpan('Target')
    advance(600)
    expect(screen.getByText('Cut')).toBeTruthy()
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByText('Cut')).toBeNull()
  })

  it('hides immediately from the warm (instant) state', () => {
    render(
      <div>
        <Tooltip tip="Cut"><span>Cut target</span></Tooltip>
        <Tooltip tip="Copy"><span>Copy target</span></Tooltip>
      </div>
    )
    const cutAnchor = hoverSpan('Cut target')
    advance(600)
    fireEvent.mouseLeave(cutAnchor)

    const copyAnchor = hoverSpan('Copy target')
    expect(screen.getByText('Copy')).toBeTruthy()
    fireEvent.mouseLeave(copyAnchor)
    expect(screen.queryByText('Copy')).toBeNull()
  })
})

describe('Tooltip — shared warm window across instances', () => {
  it('shows a sibling tooltip instantly within the warm window after the previous one closed', () => {
    render(
      <div>
        <Tooltip tip="Cut"><span>Cut target</span></Tooltip>
        <Tooltip tip="Copy"><span>Copy target</span></Tooltip>
      </div>
    )
    const cutAnchor = hoverSpan('Cut target')
    advance(600)
    expect(screen.getByText('Cut')).toBeTruthy()
    fireEvent.mouseLeave(cutAnchor)

    advance(500) // well within the ~1.5s warm window
    hoverSpan('Copy target')
    // No further time advanced — instant, no 600ms wait.
    expect(screen.getByText('Copy')).toBeTruthy()
  })

  it('goes cold again once the warm window expires with no further hover', () => {
    render(
      <div>
        <Tooltip tip="Cut"><span>Cut target</span></Tooltip>
        <Tooltip tip="Copy"><span>Copy target</span></Tooltip>
      </div>
    )
    const cutAnchor = hoverSpan('Cut target')
    advance(600)
    fireEvent.mouseLeave(cutAnchor)

    advance(1600) // past the ~1.5s warm window

    hoverSpan('Copy target')
    expect(screen.queryByText('Copy')).toBeNull()
    advance(599)
    expect(screen.queryByText('Copy')).toBeNull()
    advance(1)
    expect(screen.getByText('Copy')).toBeTruthy()
  })
})

describe('Tooltip — followMouse honors the same cold/warm logic', () => {
  it('waits the cold delay before appearing', () => {
    render(<Tooltip tip="Filename" followMouse><span>File</span></Tooltip>)
    const anchor = hoverSpan('File')
    fireEvent.mouseMove(anchor, { clientX: 10, clientY: 10 })
    expect(screen.queryByText('Filename')).toBeNull()
    advance(600)
    expect(screen.getByText('Filename')).toBeTruthy()
  })

  it('appears instantly while warm', () => {
    render(
      <div>
        <Tooltip tip="Cut"><span>Cut target</span></Tooltip>
        <Tooltip tip="Filename" followMouse><span>File</span></Tooltip>
      </div>
    )
    const cutAnchor = hoverSpan('Cut target')
    advance(600)
    fireEvent.mouseLeave(cutAnchor)

    hoverSpan('File')
    expect(screen.getByText('Filename')).toBeTruthy()
  })
})
