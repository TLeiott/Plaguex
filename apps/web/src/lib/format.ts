export function formatDuration(ms: number | undefined, opts: { compact?: boolean } = {}): string {
  if (!ms || ms <= 0) return ''
  const totalMin = Math.round(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (opts.compact) return h > 0 ? `${h}h ${m}m` : `${m}m`
  return h > 0 ? `${h} hr ${m} min` : `${m} min`
}

/** mm:ss or h:mm:ss for player clocks. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function episodeCode(
  seasonIndex: number | undefined,
  episodeIndex: number | undefined,
): string {
  const s = seasonIndex !== undefined ? `S${String(seasonIndex).padStart(2, '0')}` : ''
  const e = episodeIndex !== undefined ? `E${String(episodeIndex).padStart(2, '0')}` : ''
  return `${s}${e}`
}

export function progressFraction(
  viewOffsetMs: number | undefined,
  durationMs: number | undefined,
): number {
  if (!viewOffsetMs || !durationMs) return 0
  return Math.min(1, Math.max(0, viewOffsetMs / durationMs))
}

export function resolutionLabel(height: number | undefined, videoResolution?: string): string {
  if (videoResolution === '4k' || (height && height >= 2000)) return '4K'
  if (height && height >= 1000) return '1080p'
  if (height && height >= 700) return '720p'
  if (height) return 'SD'
  return ''
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
