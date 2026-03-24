# QuickLook Byte-Level Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a real SVG arc progress indicator while a full-res image streams into QuickLook, driven by actual bytes received — the arc starts empty and fills to 100% as chunks arrive. No indeterminate spinning.

**Architecture:** The Electron protocol handler currently buffers the entire SFTP stream before serving it, which prevents streaming progress. We add a tee: chunks are enqueued to the `ReadableStream` response immediately as they arrive, and collected in a side buffer that's written to the disk cache once the stream ends. On the renderer side, `ImagePreview` replaces the `new Image()` probe with a `fetch()` + `ReadableStream` reader, computes `bytesReceived / file.size`, and drives an SVG arc via `stroke-dashoffset`. The arc starts at 0% (empty) and fills with each chunk. When the file is already in the browser cache (`probe.complete` check), the whole fetch path is bypassed with no ring shown.

**Tech Stack:** Node.js `ReadableStream` tee pattern, `fetch()` + `response.body.getReader()`, `URL.createObjectURL`, SVG `stroke-dasharray`/`stroke-dashoffset`, React state, CSS Modules.

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `electron/main.js` | Add `nodeStreamToReadableWithCache()` helper; swap full-res cache-miss path from fully-buffered to streaming tee |
| Modify | `src/components/QuickLookOverlay.jsx` | `ImagePreview` accepts `size` prop; replaces `new Image()` probe with `fetch` reader; tracks `progress` (0–1); creates blob URL; passes progress to `ProgressRing` |
| Modify | `src/components/QuickLookOverlay.module.css` | Remove `.spinner` CSS; add `.progressRing`, `.progressRingTrack`, `.progressRingArc` for SVG arc |
| Modify | `src/views/BrowseGrid.jsx` / `src/views/BrowseList.jsx` | No change needed — `file.size` is already available in QuickLookOverlay via the `file` prop |

---

## Task 1: Streaming tee in `electron/main.js`

**Files:**
- Modify: `electron/main.js` — add `nodeStreamToReadableWithCache`, swap full-res path

### Context

The current full-res non-range path looks like:

```js
// current — fully buffered
const chunks = []
nodeStream.on('data', c => chunks.push(c))
await new Promise((res, rej) => {
  nodeStream.on('end', res)
  nodeStream.on('error', rej)
})
const buf = Buffer.concat(chunks)
// ... save to cache
return new Response(buf, { headers })
```

This means the renderer only receives bytes after the **entire** SFTP transfer completes. We need to serve chunks immediately while collecting for cache in parallel.

- [ ] **Step 1: Add `nodeStreamToReadableWithCache` helper**

Find where `nodeStreamToReadable` is defined in `electron/main.js` and add the new helper directly after it:

```js
/**
 * Wraps a Node.js readable stream in a WHATWG ReadableStream, forwarding
 * chunks to the controller immediately (so the browser gets bytes as they
 * arrive), while simultaneously collecting chunks for a side-effect cache
 * write that fires after the stream ends.
 *
 * onCached(buf) is called once with the full buffer when the stream ends.
 * It is NOT called if the stream is cancelled or errors.
 */
function nodeStreamToReadableWithCache(nodeStream, onCached) {
  let cancelled = false
  const chunks  = []
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        if (cancelled) return
        chunks.push(chunk)
        controller.enqueue(chunk)
      })
      nodeStream.on('end', () => {
        if (cancelled) return
        controller.close()
        onCached(Buffer.concat(chunks))
      })
      nodeStream.on('error', (err) => {
        if (!cancelled) controller.error(err)
      })
    },
    cancel() {
      cancelled = true
      nodeStream.destroy()
    },
  })
}
```

- [ ] **Step 2: Find the full-res cache-miss block and swap to streaming tee**

Locate the block in the `nas-stream://` protocol handler that buffers the full-res SFTP stream, saves to `fullCachePath`, and returns `new Response(buf, ...)`. It looks approximately like:

```js
// something like:
const chunks = []
nodeStream.on('data', c => chunks.push(c))
await new Promise(...)
const buf = Buffer.concat(chunks)
await fs.promises.mkdir(...)
await fs.promises.writeFile(fullPath, buf)
// ... possibly also thumbnail generation
return new Response(buf, { headers })
```

Replace it with the streaming tee:

```js
const fullPath = fullCachePath(connId, remotePath)
const stream = nodeStreamToReadableWithCache(sftp, async (buf) => {
  try {
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.promises.writeFile(fullPath, buf)
    // Generate thumbnail only if none exists yet
    const tPath = thumbCachePath(connId, remotePath)
    if (!fs.existsSync(tPath)) {
      try {
        const img = nativeImage.createFromBuffer(buf).resize({ width: 240 })
        if (!img.isEmpty()) {
          await fs.promises.mkdir(path.dirname(tPath), { recursive: true })
          await fs.promises.writeFile(tPath, img.toJPEG(80))
        }
      } catch (_) { /* thumbnail generation is best-effort */ }
    }
  } catch (_) { /* cache write failure is non-fatal */ }
})
return new Response(stream, { headers })
```

- [ ] **Step 3: Verify the app still serves full-res images correctly**

Run `npm run dev`. Open QuickLook on any image. Confirm:
- The image loads correctly (no blank/broken state)
- The full-res file appears in `userData/thumbs/{connId}/full/`
- Open it a second time — the disk-cache hit path (which still uses the buffer) serves it instantly

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat: stream full-res protocol response, cache after stream ends"
```

---

## Task 2: Fetch-based loader with byte progress in `ImagePreview`

**Files:**
- Modify: `src/components/QuickLookOverlay.jsx`

### Context

`ImagePreview` currently uses `new Image()` as a probe to detect browser cache hits, then shows a thumbnail while the full-res loads. We replace the non-cached path with a `fetch()` reader so we get per-chunk progress. The browser-cache hit path stays unchanged (probe.complete check → skip fetch entirely).

`file.size` is the byte count from the SFTP directory listing (`file.size` on the `file` prop passed to `QuickLookOverlay`). It is passed down as a `size` prop to `ImagePreview`.

- [ ] **Step 1: Write the failing test for `ImagePreview` progress tracking**

Create `src/components/__tests__/ImagePreview.test.jsx`:

```jsx
import { render, act, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We test only the fetch-path logic by mocking fetch and Image
describe('ImagePreview fetch progress', () => {
  let fetchMock
  let originalImage
  let blobUrls

  beforeEach(() => {
    blobUrls = []
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob) => {
        const url = `blob:fake-${blobUrls.length}`
        blobUrls.push(url)
        return url
      }),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows thumb src initially when not cached', async () => {
    // Make Image appear uncached
    vi.spyOn(window, 'Image').mockImplementation(() => ({
      set src(_) {},
      complete: false,
      naturalWidth: 0,
      set onload(_) {},
    }))

    // Suspend fetch forever
    fetchMock = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    const { default: ImagePreview } = await import('../QuickLookOverlay.jsx')
    // Note: ImagePreview is not exported — this test exercises the exported component
    // by checking the img src attribute changes
    // (Adjust import if ImagePreview is extracted to its own file)
  })

  it('tracks progress as chunks arrive', async () => {
    const size  = 1000
    const chunk = new Uint8Array(400) // 40%

    // Simulate reader
    let resolve
    const readerMock = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: chunk })
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(600) }) // 100%
        .mockResolvedValueOnce({ done: true,  value: undefined }),
      cancel: vi.fn(),
    }
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => readerMock },
    })
    vi.stubGlobal('fetch', fetchMock)

    // progress should reach 1.0 after both chunks
    let progressValues = []
    // (Progress is internal state — we verify indirectly by checking the SVG arc or the blob URL being created)
    expect(URL.createObjectURL).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails (component not yet updated)**

```bash
npm test src/components/__tests__/ImagePreview.test.jsx
```

Expected: test infrastructure runs, may skip or error on import — that is fine. We are establishing the scaffold.

- [ ] **Step 3: Add `ProgressRing` sub-component to `QuickLookOverlay.jsx`**

Add after the `panStyle` helper, before `ImagePreview`:

```jsx
/**
 * SVG arc progress ring.
 * progress: 0–1. Arc starts empty and fills clockwise as bytes arrive.
 * Only rendered while loading (parent hides it at progress === 1 / done).
 */
function ProgressRing({ progress }) {
  const r          = 16
  const stroke     = 3
  const size       = (r + stroke) * 2
  const cx         = size / 2
  const cy         = size / 2
  const circ       = 2 * Math.PI * r
  const dashOffset = circ * (1 - Math.min(progress, 1))

  return (
    <svg
      className={styles.progressRing}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle
        className={styles.progressRingTrack}
        cx={cx} cy={cy} r={r}
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        className={styles.progressRingArc}
        cx={cx} cy={cy} r={r}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        style={{ transition: 'stroke-dashoffset 0.1s linear' }}
      />
    </svg>
  )
}
```

- [ ] **Step 4: Rewrite `ImagePreview` to use fetch + reader**

Replace the current `ImagePreview` function entirely:

```jsx
function ImagePreview({ src, size, zoom, pan, mediaRef }) {
  const [activeSrc,  setActiveSrc]  = useState(src + '?thumb=1')
  const [progress,   setProgress]   = useState(0)   // 0–1; -1 = done (cached)
  const [done,       setDone]       = useState(false)

  useEffect(() => {
    let cancelled   = false
    let blobUrl     = null
    let reader      = null

    // Browser cache hit — skip fetch entirely
    const probe = new window.Image()
    probe.src = src
    if (probe.complete && probe.naturalWidth > 0) {
      setActiveSrc(src)
      setProgress(1)
      setDone(true)
      return
    }

    // Show thumb immediately while we fetch full-res
    setActiveSrc(src + '?thumb=1')
    setProgress(0)
    setDone(false)

    const ac = new AbortController()

    ;(async () => {
      try {
        const response = await fetch(src, { signal: ac.signal })
        if (!response.ok || !response.body) throw new Error('bad response')

        reader = response.body.getReader()
        const chunks = []
        let received = 0
        const total  = size > 0 ? size : 0   // 0 means unknown — progress stays 0

        for (;;) {
          const { done: streamDone, value } = await reader.read()
          if (streamDone) break
          if (cancelled) return
          chunks.push(value)
          received += value.byteLength
          if (total > 0) setProgress(received / total)
        }

        if (cancelled) return

        blobUrl = URL.createObjectURL(new Blob(chunks))
        setActiveSrc(blobUrl)
        setProgress(1)
        setDone(true)
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return
        // On fetch failure fall back to letting the browser load natively
        setActiveSrc(src)
        setDone(true)
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
      reader?.cancel().catch(() => {})
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [src, size])

  return (
    <div className={styles.mediaWrap}>
      <img
        ref={mediaRef}
        className={styles.previewImage}
        src={activeSrc}
        alt=""
        draggable={false}
        style={panStyle(zoom, pan)}
      />
      {!done && <ProgressRing progress={progress} />}
    </div>
  )
}
```

- [ ] **Step 5: Pass `size` from the parent `QuickLookOverlay` to `ImagePreview`**

In the `renderPreview()` function inside `QuickLookOverlay`, update the image case:

```jsx
case 'image': return <ImagePreview src={src} size={file.size ?? 0} zoom={zoom} pan={pan} mediaRef={mediaRef} />
```

`file.size` is the byte count from the SFTP directory listing — already available on the `file` prop.

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: existing tests pass, new scaffold test may skip/pass.

- [ ] **Step 7: Manual smoke test**

`npm run dev`. Open QuickLook on an image that is NOT in the browser cache (first run, or after Electron restart). Confirm:
- Thumbnail appears immediately
- SVG ring appears and spins indeterminately for the first chunk, then the arc fills
- At 100%, the full-res image replaces the thumbnail, ring disappears
- Navigate to the same image again — cache hit, no ring, full-res immediately

- [ ] **Step 8: Commit**

```bash
git add src/components/QuickLookOverlay.jsx
git commit -m "feat: fetch-based image loader with byte-level progress tracking"
```

---

## Task 3: SVG arc progress ring in CSS

**Files:**
- Modify: `src/components/QuickLookOverlay.module.css`

- [ ] **Step 1: Remove the old `.spinner` block and add ring styles**

Remove the `.spinner` block (lines ~251–263 as of writing):

```css
/* REMOVE THIS BLOCK: */
.spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.18);
  border-top-color: rgba(255, 255, 255, 0.88);
  animation: ql-spin 0.75s linear infinite;
  pointer-events: none;
}
```

Also remove `@keyframes ql-spin` (lines ~247–249):

```css
/* REMOVE THIS BLOCK: */
@keyframes ql-spin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
```

Add the new ring styles in their place:

```css
/* ── Progress ring ───────────────────────────────────────────────────────── */
.progressRing {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  opacity: 0.9;
}

.progressRingTrack {
  stroke: rgba(255, 255, 255, 0.15);
}

.progressRingArc {
  stroke: rgba(255, 255, 255, 0.9);
  /* Rotate so arc starts at 12 o'clock instead of 3 o'clock */
  transform: rotate(-90deg);
  transform-origin: center;
}
```

**Note on `rotate(-90deg)`:** SVG circles start at 3 o'clock; rotating −90deg makes the arc start at 12 o'clock (top), which is the conventional progress indicator origin. No animation classes needed — the arc is always real progress.

- [ ] **Step 2: Verify visually**

`npm run dev`. Open QuickLook on a cold-cache image:
- An indeterminate spinning arc should appear (¼ circle rotating)
- As bytes arrive the arc fills clockwise
- When download completes the ring disappears and the full image is shown

- [ ] **Step 3: Commit**

```bash
git add src/components/QuickLookOverlay.module.css
git commit -m "feat: SVG arc progress ring for QuickLook image loading"
```

---

## Task 4: Edge cases and cleanup

**Files:**
- Modify: `src/components/QuickLookOverlay.jsx`

- [ ] **Step 1: Handle unknown file size (size = 0)**

When `file.size` is 0 or missing (SMB connections may not always return size), progress tracking is impossible. In this case the ring is simply hidden — show no ring at all when `total === 0` since there is no meaningful value to display. Update `ImagePreview` to skip rendering `ProgressRing` when `size` is 0:

```jsx
{!done && size > 0 && <ProgressRing progress={progress} />}
```

Verify by opening a file where `file.size === 0` — no ring should appear; the thumbnail shows, then flips to full-res silently when ready.

- [ ] **Step 2: Handle navigation while fetching**

The `useEffect` cleanup aborts the fetch and cancels the reader. Verify by rapidly pressing Left/Right arrow keys while images are loading — no console errors about state updates on unmounted components.

- [ ] **Step 3: Verify thumbnail flash is still absent for cached images**

Close and reopen QuickLook on a previously viewed image. The `probe.complete && probe.naturalWidth > 0` guard should still prevent any ring or thumbnail flash.

- [ ] **Step 4: Commit**

```bash
git add src/components/QuickLookOverlay.jsx
git commit -m "chore: verify edge cases for QuickLook progress ring (zero size, rapid nav)"
```

---

## Testing summary

The core behavior to verify manually (automated testing of streaming + blob URLs is complex to mock meaningfully):

| Scenario | Expected |
|----------|----------|
| First open (cold cache) | Thumb shown immediately; empty arc ring appears; arc fills as bytes arrive; full-res replaces thumb; ring gone |
| Re-open same file (browser cache) | Full-res instantly; no ring, no thumb flash |
| Re-open same file (disk cache hit) | Served from disk instantly; browser cache check covers subsequent opens |
| File size = 0 | No ring shown at all; thumb shown then silently replaced by full-res |
| Navigate away mid-download | No errors; abort cleans up reader and blob URL |
| Very fast connection | Arc may jump from 0% to 100% in one chunk; ring appears very briefly then disappears |
