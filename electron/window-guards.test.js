import { describe, it, expect, vi } from 'vitest'
import { createWindowOpenHandler, createWillNavigateHandler } from './window-guards.js'

describe('createWindowOpenHandler', () => {
  it('returns a handler that always denies window-open', () => {
    const handler = createWindowOpenHandler()
    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
  })

  it('denies regardless of the requested URL', () => {
    const handler = createWindowOpenHandler()
    expect(handler({ url: 'nas-stream://conn/etc/passwd' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
  })
})

describe('createWillNavigateHandler — dev server origin', () => {
  const appUrl = 'http://localhost:5173/'

  it('prevents navigation to a different origin', () => {
    const handler = createWillNavigateHandler(appUrl)
    const event = { preventDefault: vi.fn() }
    handler(event, 'https://evil.example.com/phish')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('prevents navigation to a different scheme entirely', () => {
    const handler = createWillNavigateHandler(appUrl)
    const event = { preventDefault: vi.fn() }
    handler(event, 'file:///etc/passwd')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('allows navigation that only changes the hash (e.g. #whatsnew)', () => {
    const handler = createWillNavigateHandler(appUrl)
    const event = { preventDefault: vi.fn() }
    handler(event, 'http://localhost:5173/#whatsnew')
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('prevents navigation to a different path on the same origin', () => {
    const handler = createWillNavigateHandler(appUrl)
    const event = { preventDefault: vi.fn() }
    handler(event, 'http://localhost:5173/nested/path')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('prevents navigation on malformed URLs instead of throwing', () => {
    const handler = createWillNavigateHandler(appUrl)
    const event = { preventDefault: vi.fn() }
    expect(() => handler(event, 'not a url')).not.toThrow()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})

describe('createWillNavigateHandler — packaged file:// origin', () => {
  // file:// URLs have no meaningful "origin" (the WHATWG URL spec reports it
  // as the literal string "null" for every file: URL), so the guard must
  // also compare the pathname — otherwise any file:///anything would be
  // treated as "same origin" as the app's own index.html and a crafted link
  // could navigate the window to read an arbitrary local file.
  const appUrl = 'file:///app/out/renderer/index.html'

  it('allows navigation that only changes the hash (e.g. #whatsnew)', () => {
    const handler = createWillNavigateHandler(appUrl)
    const event = { preventDefault: vi.fn() }
    handler(event, 'file:///app/out/renderer/index.html#whatsnew')
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('prevents navigation to a different local file', () => {
    const handler = createWillNavigateHandler(appUrl)
    const event = { preventDefault: vi.fn() }
    handler(event, 'file:///etc/passwd')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('prevents navigation to a remote origin', () => {
    const handler = createWillNavigateHandler(appUrl)
    const event = { preventDefault: vi.fn() }
    handler(event, 'https://evil.example.com/phish')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})
