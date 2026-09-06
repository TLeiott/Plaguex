import { describe, expect, it } from 'vitest'
import { alternativeDecoders } from './benchmark'

const device = {
  decoders: [
    'c2.qti.hevc.decoder [video/hevc] hw=true instances=16 achievable 1920x1080=600-1200fps',
    'c2.qti.hevc.decoder.low_latency [video/hevc] hw=true instances=16',
    'c2.android.hevc.decoder [video/hevc] hw=false instances=32',
    'c2.qti.avc.decoder [video/avc] hw=true instances=16',
  ],
}

describe('alternativeDecoders', () => {
  it('lists the other decoders for the file codec', () => {
    expect(alternativeDecoders(device, 'hevc', 'c2.qti.hevc.decoder')).toEqual([
      'c2.qti.hevc.decoder.low_latency',
      'c2.android.hevc.decoder',
    ])
  })
  it('is empty without device info or for an unknown codec', () => {
    expect(alternativeDecoders(null, 'hevc', undefined)).toEqual([])
    expect(alternativeDecoders(device, 'vp9', undefined)).toEqual([])
    expect(alternativeDecoders({ decoders: 'nope' }, 'hevc', undefined)).toEqual([])
  })
})
