import { describe, expect, it } from 'vitest'
import {
  canDirectPlay,
  downloadUrl,
  isImageSubtitle,
  pickDefaultMedia,
  planPlayback,
  profileExtra,
  selectedStream,
  type PlayerCapabilities,
} from '../src/playback'
import type { PlexClientInfo } from '../src/headers'
import type { Item, MediaPart, MediaStream, MediaVersion } from '../src/types'

const client: PlexClientInfo = {
  clientIdentifier: 'cid',
  product: 'Plaguex',
  version: '1',
  platform: 'Web',
  device: 'Browser',
  deviceName: 'Test',
}
const stream = (
  id: number,
  kind: MediaStream['kind'],
  codec: string,
  extra: Partial<MediaStream> = {},
): MediaStream => ({
  id,
  kind,
  codec,
  displayTitle: codec,
  selected: false,
  default: false,
  forced: false,
  external: false,
  ...extra,
})
const part = (streams: MediaStream[], extra: Partial<MediaPart> = {}): MediaPart => ({
  id: 10,
  key: '/library/parts/10/file.mkv',
  container: 'mkv',
  streams,
  ...extra,
})
const media = (p: MediaPart, extra: Partial<MediaVersion> = {}): MediaVersion => ({
  id: 1,
  container: 'mkv',
  videoCodec: 'h264',
  audioCodec: 'aac',
  height: 1080,
  bitrate: 5000,
  parts: [p],
  ...extra,
})
const item = (versions: MediaVersion[]): Item => ({
  ratingKey: '42',
  key: '/library/metadata/42',
  type: 'movie',
  title: 'Film',
  viewCount: 0,
  media: versions,
  genres: [],
  directors: [],
  writers: [],
  roles: [],
  markers: [],
  chapters: [],
})
const caps: PlayerCapabilities = {
  containers: ['mkv'],
  videoCodecs: ['h264'],
  audioCodecs: ['aac'],
  subtitleFormats: ['srt', 'vtt'],
  hdr: true,
}

describe('playback selection', () => {
  it('picks the highest-resolution media that has parts', () => {
    expect(
      pickDefaultMedia(
        item([
          media(part([]), { height: 720 }),
          media(part([]), { height: 2160 }),
          media(part([]), { height: 4320, parts: [] }),
        ]),
      ),
    ).toBe(1)
  })

  it('selects selected, then default, then first streams except subtitles', () => {
    const p = part([
      stream(1, 'audio', 'aac'),
      stream(2, 'audio', 'aac', { default: true }),
      stream(3, 'audio', 'aac', { selected: true }),
      stream(4, 'subtitle', 'srt'),
    ])
    expect(selectedStream(p, 'audio')?.id).toBe(3)
    expect(
      selectedStream(
        part([stream(1, 'audio', 'aac'), stream(2, 'audio', 'aac', { default: true })]),
        'audio',
      )?.id,
    ).toBe(2)
    expect(selectedStream(part([stream(1, 'audio', 'aac')]), 'audio')?.id).toBe(1)
    expect(selectedStream(p, 'subtitle')).toBeUndefined()
  })

  it.each(['pgs', 'hdmv_pgs_subtitle', 'vobsub', 'dvd_subtitle', 'dvb_subtitle'])(
    'recognizes %s as an image subtitle',
    (codec) => {
      expect(isImageSubtitle(stream(1, 'subtitle', codec))).toBe(true)
    },
  )

  it('reports every direct-play rejection reason', () => {
    const p = part(
      [
        stream(1, 'video', 'hevc', { hdr: 'hdr10' }),
        stream(2, 'audio', 'aac', { selected: true }),
        stream(3, 'audio', 'dts'),
        stream(4, 'subtitle', 'pgs'),
      ],
      { container: 'avi' },
    )
    expect(
      canDirectPlay(
        media(p, { height: 2160, bitrate: 9000 }),
        p,
        { ...caps, hdr: false, maxHeight: 1080, maxBitrateKbps: 8000 },
        { audioStreamId: 3, maxBitrateKbps: 7000, subtitleStreamId: 4 },
      ).reasons,
    ).toEqual([
      'container avi not supported',
      'video codec hevc not supported',
      'HDR (hdr10) not supported',
      'resolution 2160p exceeds 1080p',
      'audio codec dts not supported',
      'bitrate 9000 kbps exceeds 7000 kbps',
      'image subtitle pgs needs burn-in',
    ])
  })

  it('uses the capability bitrate cap and rejects unsupported embedded text subtitles', () => {
    const p = part([
      stream(1, 'video', 'h264'),
      stream(2, 'audio', 'aac'),
      stream(3, 'subtitle', 'ass'),
    ])
    expect(
      canDirectPlay(
        media(p, { bitrate: 6000 }),
        p,
        { ...caps, maxBitrateKbps: 5000 },
        { subtitleStreamId: 3 },
      ).reasons,
    ).toEqual([
      'bitrate 6000 kbps exceeds 5000 kbps',
      'embedded subtitle ass cannot be extracted client-side',
    ])
  })

  it('lets native players direct play embedded and image subtitles', () => {
    const p = part([
      stream(1, 'video', 'h264'),
      stream(2, 'audio', 'aac'),
      stream(3, 'subtitle', 'ass'),
      stream(4, 'subtitle', 'pgs'),
    ])
    const native = {
      ...caps,
      embeddedSubtitles: true,
      imageSubtitles: true,
      subtitleFormats: ['ass'],
    }
    expect(canDirectPlay(media(p), p, native, { subtitleStreamId: 3 }).ok).toBe(true)
    expect(canDirectPlay(media(p), p, native, { subtitleStreamId: 4 }).ok).toBe(true)
    // Embedded text is handled by the player; no sidecar URL must be produced for it.
    const plan = planPlayback({
      baseUrl: 'http://plex.test',
      token: 'tok',
      client,
      item: item([media(p)]),
      caps: native,
      sessionId: 's',
      prefs: { subtitleStreamId: 3 },
    })
    expect(plan.method).toBe('directplay')
    expect(plan.sidecarSubtitle).toBeUndefined()
  })
})

describe('playback URLs', () => {
  it('builds a direct-play URL and an external subtitle sidecar', () => {
    const p = part([
      stream(1, 'video', 'h264'),
      stream(2, 'audio', 'aac'),
      stream(7, 'subtitle', 'srt', { external: true, key: '/sub.srt' }),
    ])
    const plan = planPlayback({
      baseUrl: 'http://plex.test',
      token: 'tok',
      client,
      item: item([media(p)]),
      caps,
      prefs: { subtitleStreamId: 7 },
      sessionId: 'session',
    })
    expect(plan.method).toBe('directplay')
    expect(plan.url).toBe(
      'http://plex.test/library/parts/10/file.mkv?X-Plex-Client-Identifier=cid&X-Plex-Product=Plaguex&X-Plex-Version=1&X-Plex-Platform=Web&X-Plex-Device=Browser&X-Plex-Device-Name=Test&X-Plex-Token=tok',
    )
    expect(plan.sidecarSubtitle?.url).toContain('/library/streams/7?encoding=utf-8&format=webvtt')
  })

  it('builds HLS parameters, burns image subtitles, and labels supported video directstream', () => {
    const p = part([
      stream(1, 'video', 'h264'),
      stream(2, 'audio', 'dts'),
      stream(8, 'subtitle', 'pgs'),
    ])
    const plan = planPlayback({
      baseUrl: 'http://plex.test/',
      token: 'tok',
      client,
      item: item([media(p)]),
      caps,
      prefs: { audioStreamId: 2, subtitleStreamId: 8, startMs: 12_999 },
      sessionId: 'abc',
    })
    const url = new URL(plan.url)
    expect(plan.method).toBe('transcode')
    expect(url.pathname).toBe('/video/:/transcode/universal/start.m3u8')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      path: '/library/metadata/42',
      session: 'abc',
      directStream: '1',
      subtitles: 'burn',
      offset: '12',
      audioStreamID: '2',
      subtitleStreamID: '8',
    })
    expect(url.searchParams.has('X-Plex-Client-Profile-Extra')).toBe(true)
  })

  it('labels HLS directstream when only audio is unsupported and transcode when video is unsupported', () => {
    const audioMismatch = part([stream(1, 'video', 'h264'), stream(2, 'audio', 'dts')])
    expect(
      planPlayback({
        baseUrl: 'http://x',
        token: 't',
        client,
        item: item([media(audioMismatch)]),
        caps,
        sessionId: 's',
      }).method,
    ).toBe('directstream')
    const videoMismatch = part([stream(1, 'video', 'hevc'), stream(2, 'audio', 'aac')])
    expect(
      planPlayback({
        baseUrl: 'http://x',
        token: 't',
        client,
        item: item([media(videoMismatch)]),
        caps,
        sessionId: 's',
      }).method,
    ).toBe('transcode')
  })

  it('builds download and profile limitations', () => {
    const p = part([])
    expect(
      new URL(downloadUrl('http://plex.test', 'tok', client, p)).searchParams.get('download'),
    ).toBe('1')
    const profile = profileExtra({ ...caps, hdr: false, maxHeight: 720 })
    expect(profile).toContain('name=video.bitDepth&value=8')
    expect(profile).toContain('name=video.height&value=720')
  })
})
