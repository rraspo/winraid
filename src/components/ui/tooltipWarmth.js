// Shared "warm" window for tooltip appearance timing. A flat cold-start
// delay on every hover is safe for a single deliberate hover but strobes
// when the pointer sweeps across a dense row of icon-only buttons, so once
// any tooltip has shown, hovering a sibling control shortly after shows its
// tooltip instantly instead of paying the delay again.
//
// Module-level (not per-Tooltip-instance) on purpose: warmth answers "was
// ANY tooltip warm recently," never "was THIS tooltip warm."
const WARM_WINDOW_MS = 1500

let warmUntil = 0

export function isTooltipWarm() {
  return Date.now() < warmUntil
}

export function markTooltipWarm() {
  warmUntil = Date.now() + WARM_WINDOW_MS
}

// Test-only: each test needs a clean warm window regardless of the real or
// faked clock value left behind by the previous test.
export function resetTooltipWarmthForTests() {
  warmUntil = 0
}
