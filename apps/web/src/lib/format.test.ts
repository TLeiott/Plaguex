import { describe, expect, it } from 'vitest'
import {
  cx,
  episodeCode,
  formatBytes,
  formatClock,
  formatDuration,
  progressFraction,
  resolutionLabel,
} from './format'

describe('formatDuration', () => {
  it('renders hours and minutes', () => {
    expect(formatDuration(6_000_000)).toBe('1 hr 40 min')
    expect(formatDuration(6_000_000, { compact: true })).toBe('1h 40m')
  })
  it('renders minutes only under an hour', () => {
    expect(formatDuration(1_500_000)).toBe('25 min')
    expect(formatDuration(1_500_000, { compact: true })).toBe('25m')
  })
  it('returns empty for missing or zero', () => {
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(0)).toBe('')
  })
})

describe('formatClock', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(3_725)).toBe('1:02:05')
  })
  it('clamps invalid values to zero', () => {
    expect(formatClock(NaN)).toBe('0:00')
    expect(formatClock(-5)).toBe('0:00')
  })
})

describe('formatBytes', () => {
  it('picks a sensible unit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2 GB')
    expect(formatBytes(150 * 1024 ** 2)).toBe('150 MB')
  })
  it('returns empty for nothing', () => {
    expect(formatBytes(undefined)).toBe('')
    expect(formatBytes(0)).toBe('')
  })
})

describe('episodeCode', () => {
  it('pads season and episode', () => {
    expect(episodeCode(1, 4)).toBe('S01E04')
    expect(episodeCode(undefined, 12)).toBe('E12')
    expect(episodeCode(3, undefined)).toBe('S03')
  })
})

describe('progressFraction', () => {
  it('clamps between 0 and 1', () => {
    expect(progressFraction(500, 1000)).toBe(0.5)
    expect(progressFraction(2000, 1000)).toBe(1)
    expect(progressFraction(undefined, 1000)).toBe(0)
    expect(progressFraction(500, undefined)).toBe(0)
  })
})

describe('resolutionLabel', () => {
  it('maps heights to labels', () => {
    expect(resolutionLabel(2160)).toBe('4K')
    expect(resolutionLabel(1080, '1080')).toBe('1080p')
    expect(resolutionLabel(720)).toBe('720p')
    expect(resolutionLabel(480)).toBe('SD')
    expect(resolutionLabel(undefined)).toBe('')
    expect(resolutionLabel(1440, '4k')).toBe('4K')
  })
})

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b')
  })
})
