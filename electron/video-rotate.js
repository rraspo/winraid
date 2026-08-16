import { shQuote } from './shell-quote.js'

const VALID_DEGREES = new Set([0, 90, 180, 270])

function assertValidDegrees(degrees) {
  if (!VALID_DEGREES.has(degrees)) throw new Error(`Invalid rotation degrees: ${degrees}`)
}

// ffmpeg gained -display_rotation (writes the modern display-matrix side data
// instead of the legacy stream rotate tag) in 5.1. Git snapshot builds
// ("N-113007-g...") and a missing/unreported version carry no "major.minor"
// we can parse, so they are assumed modern rather than downgraded to the
// legacy tag.
export function supportsDisplayRotation(version) {
  const m = /(\d+)\.(\d+)/.exec(String(version ?? ''))
  if (!m) return true
  const major = Number(m[1])
  const minor = Number(m[2])
  return major > 5 || (major === 5 && minor >= 1)
}

// displaymatrix rotation is CCW-positive; the rest of this module works in
// clockwise degrees, so it is negated and normalized to 0..359 here — the one
// place that conversion needs to happen.
function normalize(deg) {
  return ((deg % 360) + 360) % 360
}

// ffmpeg 8.1 renamed this side-data label from "displaymatrix:" to
// "Display Matrix:", so both spellings have to match — a missed rotation
// reads as none at all and rotates from the wrong origin.
const DISPLAYMATRIX_RE = /display\s*matrix\s*:\s*rotation of (-?\d+(?:\.\d+)?) degrees/i
const LEGACY_ROTATE_RE = /rotate\s*:\s*(-?\d+)/i

// Reads a file's current display rotation out of `ffmpeg -i` stderr text.
// displaymatrix (modern, CCW-positive) wins over the legacy stream metadata
// rotate tag (already clockwise) when both are present.
export function parseRotation(output) {
  const text = String(output ?? '')
  const matrix = DISPLAYMATRIX_RE.exec(text)
  if (matrix) return normalize(-Number(matrix[1]))
  const legacy = LEGACY_ROTATE_RE.exec(text)
  if (legacy) return normalize(Number(legacy[1]))
  return 0
}

export function combineRotation(current, delta) {
  return normalize(current + delta)
}

export function probeRotationCommand(path) {
  return `ffmpeg -nostdin -hide_banner -i ${shQuote(path)}`
}

// Stamping an absolute clockwise rotation on an output splits over the two
// sides of the command: modern ffmpeg writes the display matrix via
// -display_rotation, which takes a CCW angle and must precede -i since it
// applies to the input; pre-5.1 ffmpeg instead stamps the legacy per-stream
// rotate metadata tag, which belongs with the output.
export function rotationInputArgs({ degrees, modern }) {
  assertValidDegrees(degrees)
  return modern ? ['-display_rotation', String(normalize(360 - degrees))] : []
}

export function rotationOutputArgs({ degrees, modern }) {
  assertValidDegrees(degrees)
  return modern ? [] : ['-metadata:s:v:0', `rotate=${degrees}`]
}

// Rewrite the file's absolute clockwise rotation losslessly (stream copy, no
// re-encode).
export function ffmpegRotateCommand({ input, output, degrees, modern }) {
  const args = ffmpegRotateArgs({ input, output, degrees, modern })
  return `ffmpeg ${args.map((arg) => (arg === input || arg === output ? shQuote(arg) : arg)).join(' ')}`
}

// Same rotation as ffmpegRotateCommand but as an argv array for a local
// spawn — no shell, so paths need no quoting.
export function ffmpegRotateArgs({ input, output, degrees, modern }) {
  return [
    '-nostdin', '-y',
    ...rotationInputArgs({ degrees, modern }),
    '-i', input,
    '-c', 'copy', '-map', '0',
    ...rotationOutputArgs({ degrees, modern }),
    output,
  ]
}
