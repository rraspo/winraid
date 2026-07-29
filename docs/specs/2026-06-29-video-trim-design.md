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
- Fast, and lossless everywhere it can be.
- Start the cut on the frame the user picked (revised 2026-07-26, see below).
- Save as a new file or overwrite the original.
- Consistent with the existing QuickLook crop UX.

## Non-goals (YAGNI)

- Multi-segment cuts.
- Format conversion or transcoding.
- Audio extraction.
- SMB connections (no remote exec available).

## Execution model

The trim runs `ffmpeg` on the NAS over the existing SSH-exec pool (the same
mechanism used by the size scan and remote listing).

### Exact cuts (revised 2026-07-26)

The original design accepted that `-c copy` snaps the start back to the previous
keyframe — up to several seconds before the chosen in-point. In use that reads as
a bug: the clip does not begin where the user put the handle. A stream copy
cannot begin anywhere else, so an exact cut re-encodes the *fragment* between the
cut point and the next keyframe and stream-copies everything after it:

```
in-point        next keyframe                       out
   |-- re-encode --|----------- stream copy ---------|
       (< 1 GOP)                (bulk, untouched)
```

`electron/video-trim.js` picks one of three modes per cut:

| mode       | when                                          | cost              |
|------------|-----------------------------------------------|-------------------|
| `copy`     | the in-point is already on a keyframe, or the source codec has no matching encoder | single stream copy, lossless |
| `smart`    | a keyframe falls inside the selection         | one sub-second fragment re-encoded, the rest copied |
| `reencode` | no keyframe inside the selection (< 1 GOP)    | the selection is re-encoded |

Any failure on the exact path (missing encoder, a stream MPEG-TS cannot carry)
degrades to the plain `copy` cut rather than failing the operation; the IPC
result carries `exact: false` and the toast says the cut moved to the nearest
keyframe.

Details that are load-bearing, each verified against real ffmpeg output:

- **Keyframe probe**: `-skip_frame nokey` + `showinfo` demuxes rather than
  decodes; `-copyts` makes the reported times absolute. Bounded to a 30 s window
  after the cut point, which also caps how much can be re-encoded.
- **Exact fragment**: `-ss` before `-i` seeks fast to the preceding keyframe,
  then `-copyts` plus an output-side `-ss`/`-to` cuts on the exact frame. Input
  seek alone is *not* enough — copied audio would still start at the keyframe.
- **The join is MPEG-TS**, not MP4. TS carries codec parameter sets in-band, so
  the re-encoded fragment and the copied remainder each keep their own. Joined as
  MP4 the tail decodes against the head's parameter sets: HEVC output loses
  everything after the seam.
- **`-noautorotate`** on the re-encode. Without it ffmpeg bakes a rotated file's
  display matrix into the pixels, transposing the re-encoded fragment only.
- **Rotation is re-applied** on the final join: a concatenated stream carries no
  display matrix, so a phone clip would otherwise come out sideways. Reuses
  `rotationInputArgs` / `rotationOutputArgs` from `video-rotate.js`.
- **`-output_ts_offset`** places the copied remainder exactly where the fragment
  ends, so there is no stall at the seam.

Verified end to end against real ffmpeg (h264, HEVC, rotated, on-keyframe and
sub-GOP selections): the cut starts on the requested frame, the copied region
decodes bit-identically to the source, and the seam has no gap. On an open-GOP
HEVC source ffmpeg logs `Could not find ref with POC …` at the seam; the frames
were confirmed bit-identical, so it is noise, not corruption.

## Backend

### `electron/shell-quote.js` (new, pure)

Shared helper for safely embedding a path in a shell command built for SSH exec.

- `shQuote(str)`: POSIX single-quote escaping (`'` -> `'\''`). Throws / rejects
  on control characters, newlines, and NUL.
- Retrofit the existing ad-hoc `mv '${...}'` quoting in `main.js` to use this
  helper while we are here (defense-in-depth, single source of truth).

### `electron/video-trim.js` (new, pure)

Command builders return argv arrays; `shellFromArgs(argv)` renders one as an SSH
exec line, quoting only the tokens that need it (paths via `shQuote`, which
rejects control characters). The local-fallback path spawns the argv directly, so
both paths share one source of truth.

- `ffmpegTrimArgs({ input, output, start, duration })` — the plain stream copy:

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

- `ffmpegStreamProbeArgs` / `parseVideoStreamInfo` / `parseKeyframeTimes` /
  `encoderForCodec` / `planTrim` — the probe-and-decide half. One bare `-i`
  probe yields codec, pixel format, rotation and ffmpeg version.
- `ffmpegReencodeArgs` / `ffmpegTailSegmentArgs` / `ffmpegConcatArgs` — the three
  steps of an exact cut.
- `runTrim({ input, output, start, end, exec, remove, log })` — the ladder above,
  with its effects injected so the NAS (SSH exec) and local-fallback (spawn)
  paths run identical logic. Returns `{ ok, mode, degraded? }`.

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
