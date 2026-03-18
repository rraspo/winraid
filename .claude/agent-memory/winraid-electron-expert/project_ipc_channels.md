---
name: IPC channel contracts
description: All known IPC channels in WinRaid with their payload shapes and process boundaries
type: project
---

## Established channels (preload.js contextBridge -> main.js handlers)

### queue:cancel (added 2026-03-18)
- Preload: `cancel: (jobId) => ipcRenderer.invoke('queue:cancel', jobId)`
- Handler: finds job by id; if PENDING, sets ERROR then removes (sends `removed` event); if TRANSFERRING, sets ERROR with "Cancelled" message (sends `updated` event); returns `{ ok, error? }`
- Note: TRANSFERRING cancel is best-effort — no active stream abort mechanism exists yet

### queue:updated event payload shape
`{ type: 'added'|'updated'|'retry'|'cleared'|'removed', jobId?, job? }`
- `updated`: carries full `job` object with current status
- `removed`: carries `jobId`
- `cleared`: no extra fields (all DONE jobs removed)
- `retry`: carries `jobId`
- `added`: carries `jobId`

### transfer:progress event payload shape
`{ jobId, percent, bytesTransferred, totalBytes }`

**Why:** Needed for App.jsx activeTransfers counter and QueueView live updates.
**How to apply:** When adding new queue operations, always send the appropriate `queue:updated` type and include the full `job` object for `updated` events so the renderer can optimistically update without a full list refresh.
