// Counting semaphore: at most `slots` tasks run at once, the rest wait in
// arrival order. A slot is held until the task settles, either way.
export function createLimiter(slots) {
  let active = 0
  const waiting = []

  function release() {
    active--
    const next = waiting.shift()
    if (next) next()
  }

  function run(task) {
    return new Promise((resolve, reject) => {
      const start = () => {
        active++
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(release)
      }
      if (active < slots) start()
      else waiting.push(start)
    })
  }

  return { run }
}
