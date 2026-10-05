// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createClipboardStore, shouldClearClipboardForConnectionsChange } from './clipboard.js'

describe('createClipboardStore', () => {
  it('starts empty', () => {
    const store = createClipboardStore()
    expect(store.get()).toBeNull()
  })

  it('records mode, connectionId and the paths', () => {
    const store = createClipboardStore()
    store.set('cut', 'conn-1', ['/mnt/user/data/a.jpg', '/mnt/user/data/b.jpg'])
    expect(store.get()).toEqual({
      mode: 'cut',
      connectionId: 'conn-1',
      paths: ['/mnt/user/data/a.jpg', '/mnt/user/data/b.jpg'],
    })
  })

  it('accepts copy mode', () => {
    const store = createClipboardStore()
    store.set('copy', 'conn-1', ['/mnt/user/data/a.jpg'])
    expect(store.get().mode).toBe('copy')
  })

  it('takes a defensive copy of the paths array', () => {
    const store = createClipboardStore()
    const paths = ['/mnt/user/data/a.jpg']
    store.set('cut', 'conn-1', paths)
    paths.push('/mnt/user/data/b.jpg')
    expect(store.get().paths).toEqual(['/mnt/user/data/a.jpg'])
  })

  it('a second set replaces the first entirely', () => {
    const store = createClipboardStore()
    store.set('cut', 'conn-1', ['/a'])
    store.set('copy', 'conn-2', ['/b', '/c'])
    expect(store.get()).toEqual({ mode: 'copy', connectionId: 'conn-2', paths: ['/b', '/c'] })
  })

  it('clear empties the buffer', () => {
    const store = createClipboardStore()
    store.set('cut', 'conn-1', ['/a'])
    store.clear()
    expect(store.get()).toBeNull()
  })

  it('clearing an already-empty store is a no-op', () => {
    const store = createClipboardStore()
    store.clear()
    expect(store.get()).toBeNull()
  })

  it('two stores never share state', () => {
    const a = createClipboardStore()
    const b = createClipboardStore()
    a.set('cut', 'conn-1', ['/a'])
    expect(b.get()).toBeNull()
  })
})

describe('shouldClearClipboardForConnectionsChange', () => {
  const CONN = {
    id: 'conn-1', name: 'Atlas', type: 'sftp',
    sftp: { host: '10.0.0.1', port: 22, username: 'nas', remotePath: '/mnt/user/data' },
  }
  const CLIP = { mode: 'cut', connectionId: 'conn-1', paths: ['/mnt/user/data/a.jpg'] }

  it('is false with an empty clipboard, whatever the connection change', () => {
    expect(shouldClearClipboardForConnectionsChange(null, [CONN], [])).toBe(false)
  })

  it('is false when the owning connection is unchanged', () => {
    expect(shouldClearClipboardForConnectionsChange(CLIP, [CONN], [{ ...CONN }])).toBe(false)
  })

  it('is false when a different connection is edited or removed', () => {
    const otherOld = { id: 'conn-2', type: 'sftp', sftp: { host: 'nas.local' } }
    const otherNew = { id: 'conn-2', type: 'sftp', sftp: { host: 'nas2.local' } }
    expect(shouldClearClipboardForConnectionsChange(CLIP, [CONN, otherOld], [CONN, otherNew])).toBe(false)
    expect(shouldClearClipboardForConnectionsChange(CLIP, [CONN, otherOld], [CONN])).toBe(false)
  })

  it('is true when the owning connection is deleted', () => {
    expect(shouldClearClipboardForConnectionsChange(CLIP, [CONN], [])).toBe(true)
  })

  it('is true when the owning connection\'s host changes', () => {
    const edited = { ...CONN, sftp: { ...CONN.sftp, host: '10.0.0.2' } }
    expect(shouldClearClipboardForConnectionsChange(CLIP, [CONN], [edited])).toBe(true)
  })

  it('is true when the owning connection\'s remote root changes', () => {
    const edited = { ...CONN, sftp: { ...CONN.sftp, remotePath: '/mnt/user/other' } }
    expect(shouldClearClipboardForConnectionsChange(CLIP, [CONN], [edited])).toBe(true)
  })

  it('is true when the owning connection\'s credentials change', () => {
    const edited = { ...CONN, sftp: { ...CONN.sftp, username: 'other-user' } }
    expect(shouldClearClipboardForConnectionsChange(CLIP, [CONN], [edited])).toBe(true)
  })
})
