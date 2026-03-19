import { useRef, useCallback } from 'react'

export function useNavHistory() {
  const stack = useRef([])
  const idx   = useRef(-1)

  const push = useCallback((entry) => {
    stack.current = stack.current.slice(0, idx.current + 1)
    stack.current.push(entry)
    idx.current = stack.current.length - 1
  }, [])

  const back = useCallback(() => {
    if (idx.current <= 0) return null
    idx.current--
    return stack.current[idx.current]
  }, [])

  const forward = useCallback(() => {
    if (idx.current >= stack.current.length - 1) return null
    idx.current++
    return stack.current[idx.current]
  }, [])

  return { push, back, forward }
}
