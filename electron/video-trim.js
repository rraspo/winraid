import { shQuote } from './shell-quote.js'

// Seconds formatted for ffmpeg's -ss/-t (plain seconds, millisecond precision).
const fmtSecs = (n) => Number(n).toFixed(3)

// Build a stream-copy trim command. -ss before -i is a fast input seek; -t is a
// duration (not -to timestamp) to avoid the -ss/-to interaction differences
// across ffmpeg versions. -map 0 keeps video+audio+subtitles; -nostdin stops
// ffmpeg reading the SSH exec channel; -avoid_negative_ts cleans copy-cut PTS.
export function ffmpegTrimCommand({ input, output, start, duration }) {
  return [
    'ffmpeg', '-nostdin', '-y',
    '-ss', fmtSecs(start),
    '-i', shQuote(input),
    '-t', fmtSecs(duration),
    '-c', 'copy', '-map', '0', '-avoid_negative_ts', 'make_zero',
    shQuote(output),
  ].join(' ')
}

// Same trim as ffmpegTrimCommand but as an argv array for a local spawn —
// no shell, so paths need no quoting.
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

// Official Windows static build (linked from ffmpeg.org). The zip nests
// <build-name>/bin/ffmpeg.exe.
export const FFMPEG_WIN64_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

export function probeFfmpegCommand() {
  return 'ffmpeg -version'
}

export function parseFfmpegProbe(stdout) {
  const m = /ffmpeg version (\S+)/.exec(String(stdout ?? ''))
  return m ? { available: true, version: m[1] } : { available: false }
}
