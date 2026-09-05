import type { PlayerCapabilities } from '@plaguex/plex-api'

/**
 * Ask the runtime what it can decode. Uses MediaSource.isTypeSupported (what hls.js needs) and
 * HTMLMediaElement.canPlayType (what progressive direct play needs).
 */
export function probeHtml5Capabilities(): PlayerCapabilities {
  const video = typeof document !== 'undefined' ? document.createElement('video') : null
  const can = (mime: string) => (video ? video.canPlayType(mime) !== '' : false)
  const mse = (mime: string) =>
    typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported(mime) : false

  const videoCodecs: string[] = []
  if (can('video/mp4; codecs="avc1.640028"')) videoCodecs.push('h264')
  if (can('video/mp4; codecs="hvc1.1.6.L153.B0"') || can('video/mp4; codecs="hev1.1.6.L153.B0"'))
    videoCodecs.push('hevc')
  if (can('video/mp4; codecs="av01.0.08M.08"')) videoCodecs.push('av1')
  if (can('video/webm; codecs="vp9"')) videoCodecs.push('vp9')
  if (can('video/webm; codecs="vp8"')) videoCodecs.push('vp8')

  const audioCodecs: string[] = []
  if (can('audio/mp4; codecs="mp4a.40.2"')) audioCodecs.push('aac')
  if (can('audio/mpeg')) audioCodecs.push('mp3')
  if (can('audio/mp4; codecs="ac-3"')) audioCodecs.push('ac3')
  if (can('audio/mp4; codecs="ec-3"')) audioCodecs.push('eac3')
  if (can('audio/mp4; codecs="flac"') || can('audio/flac')) audioCodecs.push('flac')
  if (can('audio/webm; codecs="opus"') || can('audio/mp4; codecs="opus"')) audioCodecs.push('opus')
  if (can('audio/webm; codecs="vorbis"')) audioCodecs.push('vorbis')

  const containers: string[] = []
  if (can('video/mp4')) containers.push('mp4', 'm4v', 'mov')
  if (can('video/webm')) containers.push('webm')
  // Chromium demuxes Matroska through its WebM path; WebKit does not. Probe explicitly.
  if (can('video/x-matroska; codecs="avc1.640028"') || can('video/x-matroska'))
    containers.push('mkv')

  const hdr =
    can('video/mp4; codecs="hvc1.2.4.L153.B0"') &&
    typeof window !== 'undefined' &&
    window.matchMedia?.('(dynamic-range: high)').matches

  return {
    containers,
    videoCodecs,
    audioCodecs,
    subtitleFormats: ['srt', 'subrip', 'vtt', 'webvtt', 'mov_text', 'ass', 'ssa'],
    hdr: Boolean(hdr),
    ...(mse('video/mp4; codecs="avc1.640028"') ? {} : { maxHeight: 1080 }),
  }
}
