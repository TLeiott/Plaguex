import { describe, expect, it, vi } from 'vitest'
import type {
  NativeControl,
  NativePlayRequest,
  NativeVideoBackend,
  NativeVideoEvent,
} from '@/platform'
import { NativeVideo } from './nativeVideo'

function fakeBackend() {
  const controls: NativeControl[] = []
  let emit: ((e: NativeVideoEvent) => void) | null = null
  const backend: NativeVideoBackend & {
    emit: (e: NativeVideoEvent) => void
    controls: NativeControl[]
  } = {
    controls,
    emit: (e) => emit?.(e),
    load: vi.fn((_req: NativePlayRequest, onEvent) => {
      emit = onEvent
      return Promise.resolve(() => {
        emit = null
      })
    }),
    control: vi.fn((cmd: NativeControl) => {
      controls.push(cmd)
      return Promise.resolve()
    }),
    stop: vi.fn(() => Promise.resolve()),
  }
  return backend
}

const state = (
  patch: Partial<Extract<NativeVideoEvent, { type: 'state' }>> = {},
): NativeVideoEvent => ({
  type: 'state',
  playing: true,
  buffering: false,
  positionMs: 1000,
  bufferedMs: 5000,
  durationMs: 60_000,
  width: 1920,
  height: 800,
  decoder: 'c2.qti.avc.decoder',
  dropped: 0,
  rendered: 24,
  ...patch,
})

const req: NativePlayRequest = {
  url: 'http://x/file.mp4',
  title: 't',
  startSecs: 1,
  hls: false,
  httpHeaders: {},
  embeddedSubtitleCount: 0,
  subtitleFiles: [],
}

describe('NativeVideo shim', () => {
  it('mirrors native state into media element properties and DOM events', async () => {
    const backend = fakeBackend()
    const el = new NativeVideo(backend)
    const seen: string[] = []
    for (const t of [
      'loadedmetadata',
      'canplay',
      'play',
      'pause',
      'playing',
      'waiting',
      'timeupdate',
      'ended',
      'durationchange',
    ])
      el.addEventListener(t, () => seen.push(t))
    await el.load(req)
    expect(el.readyState).toBe(0)
    backend.emit(state())
    expect(el.currentTime).toBe(1)
    expect(el.duration).toBe(60)
    expect(el.paused).toBe(false)
    expect(el.buffered.end(0)).toBe(5)
    expect(el.videoWidth).toBe(1920)
    expect(el.getVideoPlaybackQuality().totalVideoFrames).toBe(24)
    expect(seen).toEqual(
      ['loadedmetadata', 'canplay', 'durationchange', 'play', 'playing', 'timeupdate'].sort(
        (a, b) => seen.indexOf(a) - seen.indexOf(b),
      ),
    )
    seen.length = 0
    backend.emit(state({ playing: false, buffering: true, positionMs: 2000 }))
    expect(seen).toEqual(['pause', 'waiting', 'timeupdate'])
    backend.emit({ type: 'ended' })
    expect(el.ended).toBe(true)
    expect(seen).toContain('ended')
  })

  it('forwards play, pause, seek and volume to the backend', async () => {
    const backend = fakeBackend()
    const el = new NativeVideo(backend)
    await el.load(req)
    await el.play()
    el.pause()
    el.currentTime = 42
    el.volume = 0.5
    el.muted = true
    expect(backend.controls).toEqual([
      { action: 'play' },
      { action: 'pause' },
      { action: 'seek', value: 42 },
      { action: 'volume', value: 0.5 },
      { action: 'volume', value: 0 },
    ])
    expect(el.currentTime).toBe(42)
    await el.unload()
    expect(backend.stop).toHaveBeenCalled()
    // Events after unload are ignored (channel detached).
    backend.emit(state({ positionMs: 99_000 }))
    expect(el.currentTime).toBe(42)
  })

  it('maps fatal native errors to the decode error code the recovery path checks', async () => {
    const backend = fakeBackend()
    const el = new NativeVideo(backend)
    const onError = vi.fn()
    el.addEventListener('error', onError)
    await el.load(req)
    backend.emit({ type: 'error', message: 'ERROR_CODE_DECODER_INIT_FAILED', fatal: true })
    expect(onError).toHaveBeenCalled()
    expect(el.error?.code).toBe(3)
  })
})
