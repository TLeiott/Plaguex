import {
  DOWNLOAD_PRESETS,
  estimateDownloadBytes,
  pickDefaultMedia,
  presetsFor,
  type DownloadChoice,
  type Item,
} from '@plaguex/plex-api'

export interface ChooserOption {
  id: string
  label: string
  detail: string
  choice: DownloadChoice
  /** Total bytes across all items, null when unknown for every item. */
  bytes: number | null
}

/** Options for downloading `items` (one movie/episode, or all leaves of a season/show). */
export function chooserOptions(items: Item[]): ChooserOption[] {
  if (items.length === 0) return []
  const first = items[0]!
  const options: ChooserOption[] = []
  const sum = (choice: DownloadChoice) => {
    let total = 0
    let known = false
    for (const it of items) {
      const b = estimateDownloadBytes(it, choice)
      if (b !== null) {
        total += b
        known = true
      }
    }
    return known ? total : null
  }
  // One "original" option per media version of the first item (versions rarely differ across a season).
  first.media.forEach((m, i) => {
    if (m.parts.length === 0) return
    const choice: DownloadChoice = { kind: 'original', mediaIndex: i }
    const res = m.height ? `${m.height >= 2000 ? '4K' : `${m.height}p`}` : ''
    options.push({
      id: `original-${i}`,
      label: first.media.length > 1 ? `Original · version ${i + 1}` : 'Original file',
      detail: [
        res,
        m.videoCodec?.toUpperCase(),
        m.audioCodec?.toUpperCase(),
        m.container?.toUpperCase(),
      ]
        .filter(Boolean)
        .join(' · '),
      choice,
      bytes: sum(choice),
    })
  })
  const source = first.media[pickDefaultMedia(first)]
  for (const preset of presetsFor(source)) {
    const choice: DownloadChoice = { kind: 'transcode', preset }
    options.push({
      id: preset.id,
      label: preset.label,
      detail: 'Re-encoded by the server · H.264 / AAC',
      choice,
      bytes: sum(choice),
    })
  }
  return options
}

/** Resolve the settings value ('ask' | 'original' | preset id) to a choice, or null to ask. */
export function choiceFromSetting(setting: string, items: Item[]): DownloadChoice | null {
  if (setting === 'ask' || items.length === 0) return null
  if (setting === 'original') return { kind: 'original', mediaIndex: pickDefaultMedia(items[0]!) }
  const preset = DOWNLOAD_PRESETS.find((p) => p.id === setting)
  return preset ? { kind: 'transcode', preset } : null
}
