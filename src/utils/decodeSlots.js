// Caps how many video thumbnails decode at once. Each <video> is a full media
// pipeline streaming from the NAS; a screenful of them at the same time
// starves scrolling. Requests queue first-come; a released slot goes to the
// next waiter.

export const MAX_DECODERS = 3

let active = 0
const waiting = []

function grantNext() {
  while (active < MAX_DECODERS && waiting.length > 0) {
    const ticket = waiting.shift()
    active++
    ticket.granted = true
    ticket.onGranted()
  }
}

// Returns a handle whose release() frees the slot once granted, or drops the
// request from the queue if it was still waiting. Safe to call more than once.
export function acquireDecodeSlot(onGranted) {
  const ticket = { onGranted, granted: false, done: false }
  waiting.push(ticket)
  grantNext()
  return {
    release() {
      if (ticket.done) return
      ticket.done = true
      if (ticket.granted) {
        active--
        grantNext()
      } else {
        const index = waiting.indexOf(ticket)
        if (index !== -1) waiting.splice(index, 1)
      }
    },
  }
}

export function __resetDecodeSlots() {
  active = 0
  waiting.length = 0
}
