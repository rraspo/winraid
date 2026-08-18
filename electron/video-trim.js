import { shQuote } from './shell-quote.js'
import { parseRotation, supportsDisplayRotation, rotationInputArgs, rotationOutputArgs } from './video-rotate.js'

// Seconds formatted for ffmpeg's -ss/-t (plain seconds, millisecond precision).
const fmtSecs = (n) => Number(n).toFixed(3)

// How far a cut point may sit from a keyframe and still count as landing on it.
// 10 ms is under half a frame at 60 fps, so a cut the user placed on a keyframe
// is never re-encoded over float drift.
export const KEYFRAME_TOLERANCE = 0.01

// How far past the cut point to look for the next keyframe. Everything up to
// that keyframe gets re-encoded, so this also caps the re-encoded head; a GOP
// longer than this is pathological and falls back to re-encoding the selection.
export const KEYFRAME_WINDOW = 30

// Tokens that are safe to pass through to a shell unquoted. Anything else --
// paths above all -- goes through shQuote, which also rejects control chars.
const BARE_TOKEN = /^[A-Za-z0-9_.,:+=/@-]+$/

// Rotation is only ever restored here, never cleared: an unrotated source
// needs no flags at all.
const rotationIn  = (rotation) => (rotation.degrees ? rotationInputArgs(rotation) : [])
const rotationOut = (rotation) => (rotation.degrees ? rotationOutputArgs(rotation) : [])

// An ffmpeg argv rendered as one SSH exec command line.
export function shellFromArgs(args) {
  return ['ffmpeg', ...args.map((arg) => (BARE_TOKEN.test(arg) ? arg : shQuote(arg)))].join(' ')
}

// Stream-copy trim argv. -ss before -i is a fast input seek; -t is a duration
// (not -to timestamp) to avoid the -ss/-to interaction differences across
// ffmpeg versions. -map 0 keeps video+audio+subtitles; -nostdin stops ffmpeg
// reading the SSH exec channel; -avoid_negative_ts cleans copy-cut PTS.
//
// A stream copy can only start at a keyframe, so this alone snaps the cut back
// to the preceding one -- see runTrim for how an exact cut is assembled.
export function ffmpegTrimArgs({ input, output, start, duration }) {
  return [
    '-nostdin', '-y',
    '-ss', fmtSecs(start),
    '-i', input,
    '-t', fmtSecs(duration),
    '-c', 'copy', '-map', '0', '-avoid_negative_ts', 'make_zero',
    output,
  ]
}

// Ask ffmpeg for the keyframes in [start, start+window]. -skip_frame nokey
// makes the decoder drop everything else, so this demuxes rather than decodes;
// -copyts keeps source timestamps so showinfo reports absolute times and -to
// is an absolute source timestamp too.
export function ffmpegKeyframeProbeArgs({ input, start, window }) {
  return [
    '-nostdin', '-hide_banner',
    '-skip_frame', 'nokey',
    '-ss', fmtSecs(start), '-i', input,
    '-copyts', '-to', fmtSecs(start + window),
    '-an', '-sn', '-vf', 'showinfo', '-f', 'null', '-',
  ]
}

const SHOWINFO_PTS = /pts_time:\s*([0-9]+(?:\.[0-9]+)?)/

// Keyframe times (seconds) out of showinfo stderr. Only showinfo lines count --
// ffmpeg's own progress lines carry times too.
export function parseKeyframeTimes(stderr) {
  return String(stderr ?? '')
    .split('\n')
    .filter((line) => line.includes('Parsed_showinfo'))
    .map((line) => SHOWINFO_PTS.exec(line))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b)
}

// A bare -i makes ffmpeg print its banner and the stream table, then exit
// non-zero ("at least one output file must be specified") -- the caller reads
// stderr, not the code. The banner is kept: it carries the version, which
// decides how rotation is written back.
export function ffmpegStreamProbeArgs({ input }) {
  return ['-nostdin', '-i', input]
}

// "Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / ...), yuv420p10le(tv), 3840x2160"
const VIDEO_STREAM = /:\s*Video:\s*([A-Za-z0-9_]+)[^,]*,\s*([A-Za-z0-9]+)/

export function parseVideoStreamInfo(stderr) {
  const match = VIDEO_STREAM.exec(String(stderr ?? ''))
  return match ? { codec: match[1], pixFmt: match[2] } : { codec: null, pixFmt: null }
}

// Encoder that reproduces a source codec, so the re-encoded head and the
// stream-copied tail can be glued together with -c copy. A codec that is not
// listed here gets no smart trim -- an exact cut is not worth transcoding the
// file into a different codec.
const ENCODERS = {
  h264:       { encoder: 'libx264',    options: ['-crf', '18', '-preset', 'veryfast', '-bf', '0'] },
  hevc:       { encoder: 'libx265',    options: ['-crf', '20', '-preset', 'veryfast', '-bf', '0'] },
  mpeg4:      { encoder: 'mpeg4',      options: ['-q:v', '3'] },
  mpeg2video: { encoder: 'mpeg2video', options: ['-q:v', '3'] },
}

export function encoderForCodec(codec) {
  return ENCODERS[String(codec ?? '')] ?? null
}

// Decide how to cut. 'copy' is the lossless single-pass cut (the cut point is
// already a keyframe, or nothing better is possible); 'smart' re-encodes
// [start, splitAt) and copies the rest; 'reencode' re-encodes the selection
// because no keyframe falls inside it.
export function planTrim({ start, end, keyframes, encoder, tolerance = KEYFRAME_TOLERANCE }) {
  if (keyframes.some((time) => Math.abs(time - start) <= tolerance)) return { mode: 'copy' }
  if (!encoder) return { mode: 'copy' }

  const splitAt = keyframes.find((time) => time > start + tolerance && time < end - tolerance)
  return splitAt === undefined ? { mode: 'reencode' } : { mode: 'smart', splitAt }
}

// MPEG-TS is the join format: it carries the codec parameter sets in-band, so
// the re-encoded head and the copied tail can each keep their own -- glue them
// as MP4 and the tail decodes against the head's parameter sets and falls
// apart. -muxdelay/-muxpreload 0 drop the muxer's default startup offset so
// the segments meet exactly.
const SEGMENT_MUX = ['-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts']

// Re-encode [start, end) exactly. The -ss before -i is a fast seek that lands
// on the keyframe at or before start; -copyts then keeps the source timeline
// so the output-side -ss/-to cut on the exact frame. -c copy first and -c:v
// after it re-encodes video only, leaving audio, subtitle and data streams
// untouched. -noautorotate keeps ffmpeg from baking a rotated file's display
// matrix into the pixels, which would leave the re-encoded part transposed
// against the stream-copied part; the rotation is written back instead.
export function ffmpegReencodeArgs({ input, output, start, end, encoder, pixFmt, rotation, segment = false }) {
  return [
    '-nostdin', '-y',
    ...(segment ? [] : rotationIn(rotation)),
    '-noautorotate',
    '-ss', fmtSecs(start), '-copyts', '-i', input,
    '-ss', fmtSecs(start), '-to', fmtSecs(end),
    '-c', 'copy', '-c:v', encoder.encoder, ...encoder.options,
    ...(pixFmt ? ['-pix_fmt', pixFmt] : []),
    '-map', '0',
    ...(segment ? [] : rotationOut(rotation)),
    '-avoid_negative_ts', 'make_zero',
    ...(segment ? SEGMENT_MUX : []),
    output,
  ]
}

// Stream-copied tail segment. -output_ts_offset places it exactly where the
// head ends, so concatenation leaves no stall at the seam.
export function ffmpegTailSegmentArgs({ input, output, start, duration, offset }) {
  return [
    '-nostdin', '-y',
    '-ss', fmtSecs(start), '-i', input,
    '-t', fmtSecs(duration),
    '-c', 'copy', '-map', '0',
    '-output_ts_offset', fmtSecs(offset),
    ...SEGMENT_MUX,
    output,
  ]
}

// Join the segments with the concat protocol (plain byte concatenation of
// transport streams -- no list file to write) and remux into the real
// container. Rotation is re-applied here: a concatenated stream carries no
// display matrix, so without this a phone clip would come out sideways.
export function ffmpegConcatArgs({ segments, output, rotation }) {
  return [
    '-nostdin', '-y',
    ...rotationIn(rotation),
    '-i', `concat:${segments.join('|')}`,
    '-c', 'copy', '-map', '0',
    ...rotationOut(rotation),
    '-avoid_negative_ts', 'make_zero',
    output,
  ]
}

// Sibling of a path with a suffix before the extension: /v/x.mp4 -> /v/x-head.ts
// The dot must not be the first character of the name: the temp files this runs
// on are hidden (".winraid-trim-123"), and treating that dot as an extension
// separator would put the segments next to the directory instead of inside it.
function sibling(path, suffix, ext) {
  const dot = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const hasExt = dot > slash + 1
  return (hasExt ? path.slice(0, dot) : path) + suffix + (ext ?? (hasExt ? path.slice(dot) : ''))
}

const stderrTail = (stderr) => (stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 400)

// Cut [start, end) out of input, exactly on the requested frame.
//
// A stream copy can only begin at a keyframe, so an exact cut re-encodes the
// fragment from the cut point to the next keyframe and stream-copies the rest,
// then glues the two through MPEG-TS -- a fraction of a second is re-encoded,
// the bulk stays untouched. Everything the exact path needs may be missing (an
// exotic codec, an ffmpeg without the encoder, a stream MPEG-TS cannot carry),
// so every failure short of the final copy degrades to the plain
// keyframe-snapped cut rather than leaving the user with nothing.
//
// Effects are injected so the same routine drives the NAS (SSH exec) and the
// local-fallback (spawn) paths: exec(argv) -> { code, stderr } and remove()
// operate on the machine the cut runs on.
export async function runTrim({ input, output, start, end, exec, remove, log = () => {} }) {
  const copyTrim = async () => {
    const { code, stderr } = await exec(ffmpegTrimArgs({ input, output, start, duration: end - start }))
    return code === 0 ? { ok: true, mode: 'copy' } : { ok: false, error: stderrTail(stderr) || `ffmpeg exited ${code}` }
  }

  let plan = { mode: 'copy' }
  let encoder = null
  let pixFmt = null
  let rotation = { degrees: 0, modern: true }
  try {
    const probe = await exec(ffmpegStreamProbeArgs({ input }))
    const info = parseVideoStreamInfo(probe.stderr)
    encoder = encoderForCodec(info.codec)
    pixFmt = info.pixFmt
    rotation = { degrees: parseRotation(probe.stderr), modern: supportsDisplayRotation(parseFfmpegProbe(probe.stderr).version) }

    const window = Math.min(end - start, KEYFRAME_WINDOW)
    const keyframes = await exec(ffmpegKeyframeProbeArgs({ input, start, window }))
    plan = planTrim({ start, end, keyframes: parseKeyframeTimes(keyframes.stderr), encoder })
  } catch (err) {
    log('warn', `Keyframe probe failed, cutting on the nearest keyframe instead: ${err.message}`)
    return { ...(await copyTrim()), degraded: true }
  }

  if (plan.mode === 'copy') return copyTrim()

  const degrade = async (reason) => {
    log('warn', `Exact cut unavailable, cutting on the nearest keyframe instead: ${reason}`)
    const result = await copyTrim()
    return result.ok ? { ...result, degraded: true } : result
  }

  if (plan.mode === 'reencode') {
    log('info', `No keyframe inside the selection — re-encoding ${(end - start).toFixed(2)}s`)
    const { code, stderr } = await exec(ffmpegReencodeArgs({ input, output, start, end, encoder, pixFmt, rotation }))
    return code === 0 ? { ok: true, mode: 'reencode' } : degrade(stderrTail(stderr) || `ffmpeg exited ${code}`)
  }

  const headPath = sibling(output, '-head', '.ts')
  const tailPath = sibling(output, '-tail', '.ts')
  try {
    const head = await exec(ffmpegReencodeArgs({
      input, output: headPath, start, end: plan.splitAt, encoder, pixFmt, rotation, segment: true,
    }))
    if (head.code !== 0) return degrade(stderrTail(head.stderr) || `ffmpeg exited ${head.code}`)

    const tail = await exec(ffmpegTailSegmentArgs({
      input, output: tailPath, start: plan.splitAt, duration: end - plan.splitAt, offset: plan.splitAt - start,
    }))
    if (tail.code !== 0) return degrade(stderrTail(tail.stderr) || `ffmpeg exited ${tail.code}`)

    const joined = await exec(ffmpegConcatArgs({ segments: [headPath, tailPath], output, rotation }))
    if (joined.code !== 0) return degrade(stderrTail(joined.stderr) || `ffmpeg exited ${joined.code}`)
    return { ok: true, mode: 'smart' }
  } finally {
    await remove(headPath)
    await remove(tailPath)
  }
}

// Pinned so the bytes a user downloads don't change when upstream
// re-publishes a "latest" alias. Bump this only for a deliberate re-pin, and
// keep every candidate below pointing at the same version.
export const FFMPEG_PINNED_VERSION = '8.1.2'

// Ordered fallback chain for the local-fallback download: the project's own
// mirror first (the only source it controls), then a dated (not `-latest`)
// BtbN autobuild, then gyan.dev's versioned package as a last resort. Every
// URL points at a fixed release, never a moving rolling-alias build. All
// three archives nest <build-name>/bin/ffmpeg.exe.
//
// The mirrored archive is repacked to hold only ffmpeg.exe, which is the one
// file kept below - roughly a third the size of the upstream archives, whose
// bundled ffplay/ffprobe/docs are downloaded and discarded. The third-party
// candidates are whatever their publishers ship, so they stay full size.
export const FFMPEG_WIN64_CANDIDATES = [
  'https://github.com/rraspo/winraid-deps/releases/download/ffmpeg-8.1.2/ffmpeg-8.1.2-win64-ffmpeg-only.zip',
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-16-13-00/ffmpeg-n8.1.2-44-g7c533d0f86-win64-gpl-8.1.zip',
  'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip',
]

export function probeFfmpegCommand() {
  return 'ffmpeg -version'
}

export function parseFfmpegProbe(stdout) {
  const m = /ffmpeg version (\S+)/.exec(String(stdout ?? ''))
  return m ? { available: true, version: m[1] } : { available: false }
}
