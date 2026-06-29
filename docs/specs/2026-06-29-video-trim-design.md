# Video Trim — Design

Date: 2026-06-29
Status: Approved (pending implementation)

## Summary

Add a simple video trimmer to WinRaid. A user viewing a video in QuickLook can
mark an in-point and out-point and produce a trimmed clip. The cut runs on the
NAS via `ffmpeg` over the existing SSH-exec pool, stream-copy only (lossless,
near-instant, no data transfer). Output can be saved as a new file or overwrite
the original.

This mirrors the existing inline image **crop** flow in QuickLook (an edit icon
in the top bar that enters an inline edit mode with Cancel / Save as new /
Overwrite), so it is consistent with patterns the user already knows.

## Goals

- Trim a single in/out range from a video.
- Run server-side on the NAS; never round-trip the file through the client.
- Lossless and fast (stream-copy).
- Save as a new file or overwrite the original.
- Consistent with the existing QuickLook crop UX.

## Non-goals (YAGNI)

- Multi-segment cuts.
- Re-encode / frame-accurate cuts.
- Format conversion or transcoding.
- Audio extraction.
- SMB connections (no remote exec available).

## Execution model

The trim runs `ffmpeg` on the NAS over the existing SSH-exec pool (the same
mechanism used by the size scan and remote listing). Stream-copy means no
re-encoding: the operation is near-instant and lossless.

Caveat (accepted): with `-c copy`, the start point snaps to the nearest
keyframe, so the actual cut may begin up to a second or two before the chosen
in-point. This is the standard trade-off for a fast, lossless, "simple" trim.

## Backend

### `electron/shell-quote.js` (new, pure)

Shared helper for safely embedding a path in a shell command built for SSH exec.

- `shQuote(str)`: POSIX single-quote escaping (`'` -> `'\''`). Throws / rejects
  on control characters, newlines, and NUL.
- Retrofit the existing ad-hoc `mv '${...}'` quoting in `main.js` to use this
  helper while we are here (defense-in-depth, single source of truth).

### `electron/video-trim.js` (new, pure)

- `ffmpegTrimCommand({ input, output, start, duration })` -> command string:

  ```
  ffmpeg -nostdin -y -ss <start> -i '<input>' -t <duration> \
         -c copy -map 0 -avoid_negative_ts make_zero '<output>'
  ```

  - `-ss` before `-i` = fast input seek.
  - `-t <duration>` where `duration = end - start`. We use `-t` (duration), not
    `-to` (timestamp), to avoid the known `-ss`/`-to` interaction differences
    across ffmpeg versions.
  - `-c copy` = stream-copy (lossless), `-map 0` = keep all streams
    (video + audio + subtitles), `-nostdin` = do not read the exec channel
    stdin, `-avoid_negative_ts make_zero` = clean copy-cut timestamps.
  - `input` and `output` are quoted via `shQuote`.

- `probeFfmpegCommand()` -> `ffmpeg -version`.
- `parseFfmpegProbe(stdout)` -> `{ available: boolean, version?: string }`.
  ffmpeg availability is detected once per connection and cached, mirroring the
  existing `_detectSizeTool` pattern.

### Paths and safety

- Both `input` and `output` are absolute (output is created in the same
  directory as the input), so there is no leading-dash option-injection risk.
- All dynamic paths pass through `shQuote`; control chars / newlines / NUL are
  rejected.
- `main.js` validates inputs before acting: `connId` present, `path` is a
  non-empty string, `start >= 0`, `end > start`, `overwrite` is boolean.
- Overwrite never writes the file ffmpeg is reading: ffmpeg writes to a temp
  sibling (e.g. `.<stem>.trim.tmp<ext>`), then an SFTP `rename` moves it over
  the original. SFTP rename is injection-immune (protocol field, not shell) and
  atomic.
- Generous exec timeout via `execWithTimeout` (copy is fast, but allow headroom
  for large ranges).

## IPC surface

- `main.js`: `ipcMain.handle('remote:trim-video', handler)`.
  - Acquires a pooled SSH client for the connection.
  - Detects ffmpeg (cached); if missing, returns a clear error.
  - Computes `duration = end - start`.
  - New file: resolves a free `_trimmed` name (see Output). Overwrite: writes to
    temp then SFTP-renames over the original.
  - Invalidates the on-disk full/thumb cache for the mutated path.
  - Returns `{ ok: true, outPath }` or `{ ok: false, error }`.
- `preload.js`:
  `remote.trimVideo(connId, { path, start, end, overwrite }) -> { ok, outPath?, error? }`.
- `src/__mocks__/winraid.js`: add `remote.trimVideo` returning
  `{ ok: true, outPath: '...' }`.

## UX (renderer)

In `src/components/QuickLookOverlay.jsx`, mirroring the existing crop flow:

- For `type === 'video'` on an SFTP connection, render a **Scissors** edit icon
  in the top bar next to the existing Camera (snapshot) button, with the same
  placement and styling as the image **Crop** icon. The icon is gated off for
  SMB connections (no remote exec). The overlay receives the connection type via
  a new prop (e.g. `canServerEdit`, true when `conn.type === 'sftp'`), set by
  `BrowseView`.
- Clicking the icon enters an inline **trim mode** (no modal). As crop does, the
  current `file` is snapshotted on entry so a stray navigation cannot retarget
  the save.
- The trim toolbar parallels the crop toolbar:
  - Displays **In** and **Out** times using the existing HH-MM-SS duration
    formatter.
  - **Set start** / **Set end** buttons capture `videoRef.current.currentTime`.
  - **Cancel / Save as new / Overwrite** actions.
- The video keeps playing normally; marking only reads `currentTime`.
- Save is disabled until `out > in` by a small epsilon.

## Output handling

Mirrors the crop save flow exactly:

- **Save as new:** resolve the next free `_trimmed` / `_trimmed_2` ... name in
  the parent directory via the existing `nextAvailableCopyPath` helper
  (parameterized to accept a `_trimmed` suffix). After success, `onNavigate` to
  the new clip so the result is shown immediately.
- **Overwrite:** temp sibling -> SFTP rename over the original; then
  `cache.invalidateFile`, `remoteFS.invalidate` + re-`list`, and bump
  `cacheBust` — identical to crop's post-save refresh.

## Error handling

- ffmpeg not installed on the NAS -> toast: "ffmpeg is not installed on the NAS."
- ffmpeg non-zero exit -> toast with the stderr tail.
- Exec timeout -> clear timeout message.
- Invalid range -> prevented in the UI (Save disabled).

## Testing (TDD)

- `electron/shell-quote.test.js`: adversarial inputs — `'; rm -rf ~ #`,
  `$(reboot)`, backticks, leading `-`, embedded newline / NUL rejected; a benign
  path round-trips to its literal value.
- `electron/video-trim.test.js`: `ffmpegTrimCommand` emits correct
  `-ss` / `-t` / `-c copy` / `-map 0`; `duration = end - start`; paths quoted;
  `parseFfmpegProbe` detects availability and version.
- `QuickLookOverlay` tests: trim icon shows only for SFTP video (hidden for SMB
  and non-video); entering trim shows the toolbar; Set start / Set end update the
  displayed times; Save calls `remote.trimVideo` with the correct args and is
  disabled on an invalid range; ffmpeg-missing / error surfaces a toast.

## Files touched

New:
- `electron/shell-quote.js` + `electron/shell-quote.test.js`
- `electron/video-trim.js` + `electron/video-trim.test.js`

Modified:
- `electron/main.js` (IPC handler, ffmpeg detect/cache, temp+rename, retrofit
  `mv` quoting to `shQuote`)
- `electron/preload.js` (`remote.trimVideo`)
- `src/components/QuickLookOverlay.jsx` (Scissors icon, trim mode, toolbar, save)
- `src/components/QuickLookOverlay.module.css` (trim toolbar styling, reusing
  crop toolbar styles where possible)
- `src/views/BrowseView.jsx` (pass `canServerEdit` / connection type to overlay)
- `src/utils/cropHelpers.js` (parameterize `nextAvailableCopyPath` suffix; it
  currently hard-codes `_cropped`)
- `src/__mocks__/winraid.js` (`remote.trimVideo`)
