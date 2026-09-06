import { describe, expect, it, vi } from 'vitest'
import { androidExternalPlayer, type ExternalPlayResult } from './androidExternal'
import type { ExternalPlayerEvent } from './types'

const req = {
  url: 'http://127.0.0.1:1/files/1',
  title: 'Movie',
  startSecs: 90,
  subtitleFiles: ['http://s/sub.vtt'],
  httpHeaders: [],
  fullscreen: true,
}

async function run(result: ExternalPlayResult) {
  const invoke = vi.fn().mockResolvedValue(result)
  const player = androidExternalPlayer(invoke)
  const events: ExternalPlayerEvent[] = []
  player.subscribe((e) => events.push(e))
  await player.play(req, 's1')
  return { invoke, events }
}

describe('androidExternalPlayer', () => {
  it('launches with title, start position and first subtitle, then reports where it stopped', async () => {
    const { invoke, events } = await run({
      resultCode: -1,
      positionMs: 120_000,
      durationMs: 7_200_000,
      completed: false,
    })
    expect(invoke).toHaveBeenCalledWith({
      url: req.url,
      mime: 'video/*',
      title: 'Movie',
      positionMs: 90_000,
      subtitleUrl: 'http://s/sub.vtt',
    })
    expect(events).toEqual([
      { sessionId: 's1', type: 'started' },
      { sessionId: 's1', type: 'ended', timeSecs: 120, reason: 'quit' },
    ])
  })
  it('treats completion or the last 5% as end of file', async () => {
    const a = await run({ resultCode: -1, positionMs: 0, durationMs: 0, completed: true })
    expect(a.events[1]).toMatchObject({ reason: 'eof', timeSecs: 0 })
    const b = await run({
      resultCode: -1,
      positionMs: 960_000,
      durationMs: 1_000_000,
      completed: false,
    })
    expect(b.events[1]).toMatchObject({ reason: 'eof' })
  })
  it('maps unknown position to NaN and VLC error codes to an error', async () => {
    const { events } = await run({
      resultCode: 3,
      positionMs: -1,
      durationMs: -1,
      completed: false,
    })
    expect(events[1]).toMatchObject({ reason: 'error' })
    expect((events[1] as { timeSecs: number }).timeSecs).toBeNaN()
  })
})
