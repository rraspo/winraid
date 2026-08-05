import { ffmpegStreamProbeArgs, parseVideoStreamInfo, encoderForCodec } from './video-trim.js'

// Safe target when the source codec has no matching entry in video-trim's
// ENCODERS map. Unlike a trim, a crop always re-encodes the whole file, so
// there is no lossless fallback to fall back to -- changing the codec beats
// failing outright.
export const FALLBACK_ENCODER = { encoder: 'libx264', options: ['-crf', '18', '-preset', 'veryfast', '-bf', '0'] }

// Spatial crop argv: re-encodes the full file with the crop filter, copying
// every non-video stream untouched. No -noautorotate here -- ffmpeg's default
// autorotation decodes, transposes and crops a rotated phone clip in its
// display orientation, and the output then carries no rotation metadata of
// its own; that is the wanted behavior, not an oversight.
export function ffmpegCropArgs({ input, output, rect, encoder, pixFmt }) {
  return [
    '-nostdin', '-y',
    '-i', input,
    '-vf', `crop=${rect.width}:${rect.height}:${rect.x}:${rect.y}`,
    '-c', 'copy', '-c:v', encoder.encoder, ...encoder.options,
    ...(pixFmt ? ['-pix_fmt', pixFmt] : []),
    '-map', '0',
    output,
  ]
}

const stderrTail = (stderr) => (stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 400)

// Crop input to rect, re-encoding video and copying every other stream.
//
// Effects are injected so the same routine drives the NAS (SSH exec) and the
// local-fallback (spawn) paths: exec(argv) -> { code, stderr } operates on
// the machine the crop runs on.
export async function runCrop({ input, output, rect, exec, log = () => {} }) {
  let encoder = null
  let pixFmt  = null
  try {
    const probe = await exec(ffmpegStreamProbeArgs({ input }))
    const info  = parseVideoStreamInfo(probe.stderr)
    encoder = encoderForCodec(info.codec)
    pixFmt  = info.pixFmt
  } catch (err) {
    log('warn', `Stream probe failed, cropping with the fallback encoder instead: ${err.message}`)
  }

  if (!encoder) {
    encoder = FALLBACK_ENCODER
    pixFmt  = 'yuv420p'
  }

  const { code, stderr } = await exec(ffmpegCropArgs({ input, output, rect, encoder, pixFmt }))
  return code === 0 ? { ok: true } : { ok: false, error: stderrTail(stderr) || `ffmpeg exited ${code}` }
}
