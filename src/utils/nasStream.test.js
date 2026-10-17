import { describe, it, expect } from 'vitest'
import { nasStreamUrl } from './nasStream'

describe('nasStreamUrl', () => {
  it.each(['/docs/a #1.pdf', '/docs/100%.pdf', '/docs/what?.pdf', '/docs/a&b=c.pdf'])(
    'round-trips %s through URL parsing',
    (remotePath) => {
      const url = new URL(nasStreamUrl('conn1', remotePath))
      expect(url.hostname).toBe('conn1')
      expect(decodeURIComponent(url.pathname)).toBe(remotePath)
      expect(url.hash).toBe('')
      expect(url.search).toBe('')
    },
  )
})
