// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createLimiter } from './limiter.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createLimiter', () => {
  it('never runs more than the slot count at once', async () => {
    const limiter = createLimiter(2)
    const gates = [deferred(), deferred(), deferred()]
    let running = 0
    let peak = 0
    const results = gates.map((gate, index) => limiter.run(async () => {
      running++
      peak = Math.max(peak, running)
      await gate.promise
      running--
      return index
    }))

    await tick()
    expect(running).toBe(2)
    gates[0].resolve()
    await tick()
    expect(running).toBe(2)
    gates[1].resolve()
    gates[2].resolve()

    expect(await Promise.all(results)).toEqual([0, 1, 2])
    expect(peak).toBe(2)
  })

  it('frees the slot when a task rejects', async () => {
    const limiter = createLimiter(1)
    const failing = limiter.run(async () => { throw new Error('boom') })
    const next = limiter.run(async () => 'ran')
    await expect(failing).rejects.toThrow('boom')
    expect(await next).toBe('ran')
  })

  it('shares slots across independent callers of the same limiter', async () => {
    const limiter = createLimiter(1)
    const gate = deferred()
    let secondStarted = false
    const first = limiter.run(() => gate.promise)
    const second = limiter.run(async () => { secondStarted = true })
    await tick()
    expect(secondStarted).toBe(false)
    gate.resolve()
    await Promise.all([first, second])
    expect(secondStarted).toBe(true)
  })
})
