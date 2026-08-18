// Whether to ask the user before running a trim/rotate on this PC instead of
// the NAS. The prompt is a consent step — the work costs this machine's time
// and bandwidth — so it should appear once, not once per file.
//
// The acknowledgement lives at module scope on purpose: QuickLook mounts a
// fresh component per opened file, so anything held in component state resets
// and re-prompts on the next video.

let acked = false

export function markLocalTrimAcked() {
  acked = true
}

export function isLocalTrimAcked() {
  return acked
}

// Test seam — the flag is deliberately process-wide otherwise.
export function resetLocalTrimAck() {
  acked = false
}

// `source` is where the local ffmpeg came from: 'downloaded' (fetched through
// this prompt), 'custom' (the user pointed at one), or 'path' (found on PATH,
// never chosen). The first two already carry the user's decision.
export function needsLocalTrimConsent({ mode, source, acked: alreadyAcked }) {
  if (mode !== 'local') return false
  if (source === 'downloaded' || source === 'custom') return false
  return !alreadyAcked
}
