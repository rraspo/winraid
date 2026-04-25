import { vi } from 'vitest'

export const list = vi.fn().mockResolvedValue([])
export const tree = vi.fn().mockResolvedValue(undefined)
export const update = vi.fn()
export const invalidate = vi.fn()
export const invalidateSubtree = vi.fn()
export const invalidateConnection = vi.fn()
export const getSnapshot = vi.fn().mockReturnValue(null)
export const subscribe = vi.fn().mockReturnValue(() => {})
export const clearAll = vi.fn()
