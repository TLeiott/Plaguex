import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { DownloadChoice, Item } from '@plaguex/plex-api'
import { chooserOptions } from '@/downloads/chooser'
import { useSession } from '@/plex/session'
import { formatBytes } from '@/lib/format'
import { Button } from './ui'

interface Props {
  items: Item[]
  title: string
  onPick: (choice: DownloadChoice) => void
  onClose: () => void
}

/** Bottom sheet listing download qualities with the resulting (estimated) size. */
export function DownloadChooser({ items, title, onPick, onClose }: Props) {
  const options = chooserOptions(items)
  const [selected, setSelected] = useState(options[0]?.id ?? '')
  const [remember, setRemember] = useState(false)
  const updateSettings = useSession((s) => s.updateSettings)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const pick = () => {
    const opt = options.find((o) => o.id === selected)
    if (!opt) return
    if (remember)
      updateSettings({
        downloadQuality: opt.choice.kind === 'original' ? 'original' : opt.choice.preset.id,
      })
    onPick(opt.choice)
  }
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 md:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-chooser-title"
        className="w-full max-w-md rounded-t-2xl border border-line bg-bg-2 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="download-chooser"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="download-chooser-title" className="text-lg font-semibold">
              Download quality
            </h2>
            <p className="text-sm text-fg-3">
              {title}
              {items.length > 1 ? ` · ${items.length} items` : ''}
            </p>
          </div>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>
        <ul className="flex flex-col gap-1" role="radiogroup">
          {options.map((o) => (
            <li key={o.id}>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-bg-3 ${selected === o.id ? 'bg-bg-3 ring-1 ring-accent' : ''}`}
              >
                <input
                  type="radio"
                  name="download-quality"
                  value={o.id}
                  checked={selected === o.id}
                  onChange={() => setSelected(o.id)}
                  className="accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{o.label}</span>
                  <span className="block truncate text-xs text-fg-3">{o.detail}</span>
                </span>
                <span
                  className="shrink-0 text-sm tabular-nums text-fg-2"
                  data-testid="download-size"
                >
                  {o.bytes !== null
                    ? `${o.choice.kind === 'transcode' ? '~' : ''}${formatBytes(o.bytes)}`
                    : '?'}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-fg-3">
          Re-encoded sizes are estimates. The server may apply its own quality limit for shared
          users.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="accent-accent"
          />
          Always use this quality (change in Settings)
        </label>
        <Button
          variant="primary"
          size="lg"
          className="mt-4 w-full"
          onClick={pick}
          data-testid="download-confirm"
        >
          Download
        </Button>
      </div>
    </div>
  )
}
