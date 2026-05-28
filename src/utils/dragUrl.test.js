import { describe, it, expect } from 'vitest'
import { extractDragUrls } from './dragUrl'

function makeDataTransfer(types) {
  return {
    getData(type) { return types[type] ?? '' },
  }
}

describe('extractDragUrls', () => {
  it('returns an empty array for a null or undefined DataTransfer', () => {
    expect(extractDragUrls(null)).toEqual([])
    expect(extractDragUrls(undefined)).toEqual([])
  })

  it('returns an empty array when no URL-flavoured types are populated', () => {
    expect(extractDragUrls(makeDataTransfer({}))).toEqual([])
  })

  it('extracts a single URL from text/uri-list', () => {
    const dt = makeDataTransfer({ 'text/uri-list': 'https://example.com/cat.jpg' })
    expect(extractDragUrls(dt)).toEqual(['https://example.com/cat.jpg'])
  })

  it('ignores #-prefixed comment lines in text/uri-list', () => {
    const dt = makeDataTransfer({
      'text/uri-list': '# comment\nhttps://example.com/a.jpg\n# another\nhttps://example.com/b.jpg',
    })
    expect(extractDragUrls(dt)).toEqual(['https://example.com/a.jpg', 'https://example.com/b.jpg'])
  })

  it('parses Firefox-style text/x-moz-url (URL on even lines, TITLE on odd lines)', () => {
    const dt = makeDataTransfer({
      'text/x-moz-url': 'https://example.com/cat.jpg\nCat',
    })
    expect(extractDragUrls(dt)).toEqual(['https://example.com/cat.jpg'])
  })

  it('combines URLs from text/uri-list and text/x-moz-url, deduping', () => {
    const dt = makeDataTransfer({
      'text/uri-list':  'https://example.com/cat.jpg',
      'text/x-moz-url': 'https://example.com/cat.jpg\nCat',  // duplicate
    })
    expect(extractDragUrls(dt)).toEqual(['https://example.com/cat.jpg'])
  })

  it('falls back to text/plain only when no URL types yielded anything', () => {
    const dt = makeDataTransfer({ 'text/plain': 'https://example.com/from-plain.png' })
    expect(extractDragUrls(dt)).toEqual(['https://example.com/from-plain.png'])
  })

  it('does NOT use text/plain when text/uri-list already produced URLs', () => {
    const dt = makeDataTransfer({
      'text/uri-list': 'https://example.com/a.jpg',
      'text/plain':    'https://example.com/different.jpg',
    })
    expect(extractDragUrls(dt)).toEqual(['https://example.com/a.jpg'])
  })

  it('rejects non-http(s) schemes (file:, javascript:, data:)', () => {
    const dt = makeDataTransfer({
      'text/uri-list': 'file:///etc/passwd\njavascript:alert(1)\ndata:text/plain,hi\nhttps://example.com/ok.jpg',
    })
    expect(extractDragUrls(dt)).toEqual(['https://example.com/ok.jpg'])
  })

  it('trims whitespace from URLs', () => {
    const dt = makeDataTransfer({ 'text/uri-list': '  https://example.com/cat.jpg  ' })
    expect(extractDragUrls(dt)).toEqual(['https://example.com/cat.jpg'])
  })

  it('handles CRLF line endings', () => {
    const dt = makeDataTransfer({
      'text/uri-list': 'https://example.com/a.jpg\r\nhttps://example.com/b.jpg',
    })
    expect(extractDragUrls(dt)).toEqual(['https://example.com/a.jpg', 'https://example.com/b.jpg'])
  })
})
