import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useState } from 'react'
import { Activity, Copy, Share2 } from 'lucide-react'
import { formatReport, runBenchmark, type Report } from '@/diagnostics/benchmark'
import { platform } from '@/platform'
import { useDownloads } from '@/downloads/store'
import { Button } from '@/components/ui'
import { cx } from '@/lib/format'

export const Route = createFileRoute('/_app/diagnostics')({
  // `seconds` shortens the playback probes (used by the UI test suite).
  validateSearch: z.object({ seconds: z.number().optional() }),
  component: DiagnosticsPage,
})

function DiagnosticsPage() {
  const { seconds } = Route.useSearch()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const downloaded = useDownloads((s) => Object.values(s.items).find((d) => d.status === 'done'))
  const canOpenElsewhere = Boolean(platform().openVideo && platform().downloads && downloaded)
  const openElsewhere = async () => {
    const p = platform()
    if (!p.openVideo || !p.downloads || !downloaded) return
    const url = await p.downloads.playbackUrl(downloaded.id)
    if (!url) {
      setNotice('Downloaded file not available')
      return
    }
    await p.openVideo(url, 'video/mp4').catch((e: unknown) => setNotice(String(e)))
  }

  const run = async () => {
    setRunning(true)
    setReport(null)
    setProgress([])
    try {
      const r = await runBenchmark((m) => setProgress((p) => [...p.slice(-7), m]), {
        playbackSeconds: seconds ?? 15,
      })
      setText(formatReport(r))
      setReport(r)
    } finally {
      setRunning(false)
    }
  }
  const share = async () => {
    const p = platform()
    const name = `plaguex-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    if (p.shareFile) {
      await p.shareFile({
        name,
        mime: 'text/plain',
        content: text,
        subject: 'Plaguex diagnostics',
      })
      return
    }
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Copied to clipboard')
    } catch {
      setNotice('Clipboard not available; use Share')
    }
  }

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6 safe-px"
      data-testid="diagnostics-page"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Diagnostics &amp; benchmark</h1>
        <p className="mt-1 text-sm text-fg-2">
          Checks plex.tv, every server connection, library and image loading, downloads and the
          local file server, then plays a downloaded file and a stream full-screen for 15 seconds
          each while measuring stalls, dropped frames and frame pacing. Keep the screen on and
          watch: what stutters for you shows up as hitches in the report. Nothing is uploaded; you
          decide where the report goes.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="lg"
          onClick={() => void run()}
          loading={running}
          data-testid="run-benchmark"
        >
          <Activity className="size-5" /> {running ? 'Running…' : 'Run benchmark'}
        </Button>
        {report ? (
          <>
            <Button size="lg" onClick={() => void share()} data-testid="share-report">
              <Share2 className="size-5" /> Share report
            </Button>
            <Button size="lg" variant="ghost" onClick={() => void copy()}>
              <Copy className="size-5" /> Copy
            </Button>
          </>
        ) : null}
      </div>
      {canOpenElsewhere ? (
        <div className="rounded-card border border-line bg-bg-2 p-4 text-sm">
          <p className="font-medium">A/B check: play the downloaded file in another app</p>
          <p className="mt-1 text-fg-2">
            Opens the same file (via the local file server) in a player of your choice, e.g. VLC or
            the Samsung video player. If it stutters there too, the device is the limit, not
            Plaguex.
          </p>
          <Button
            className="mt-3"
            onClick={() => void openElsewhere()}
            data-testid="open-elsewhere"
          >
            Open in another player
          </Button>
        </div>
      ) : null}
      {notice ? <p className="text-sm text-fg-2">{notice}</p> : null}
      {running ? (
        <ul
          className="rounded-card border border-line bg-bg-2 p-4 font-mono text-xs text-fg-2"
          aria-live="polite"
        >
          {progress.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
      {report ? (
        <>
          <ul
            className="divide-y divide-line rounded-card border border-line bg-bg-2"
            data-testid="benchmark-steps"
          >
            {report.steps.map((s) => (
              <li key={s.name} className="flex items-start gap-3 p-3 text-sm">
                <span
                  className={cx(
                    'mt-0.5 w-12 shrink-0 rounded px-1.5 text-center text-[11px] font-bold uppercase',
                    s.status === 'ok' && 'bg-accent/15 text-accent',
                    s.status === 'warn' && 'bg-warn/15 text-warn',
                    s.status === 'fail' && 'bg-danger/15 text-danger',
                    s.status === 'skip' && 'bg-bg-3 text-fg-3',
                  )}
                >
                  {s.status}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {s.name} <span className="text-fg-3">· {s.ms} ms</span>
                  </span>
                  <span className="block break-words text-fg-2">{s.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {report.playback.map((p) => (
            <div
              key={p.label}
              className="rounded-card border border-line bg-bg-2 p-4 text-sm"
              data-testid="playback-probe"
            >
              <p className="font-semibold">{p.label}</p>
              <p className="text-fg-3">{p.source}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-fg-2">
                <dt>First frame</dt>
                <dd>{p.timeToFirstFrameMs ?? 'never'} ms</dd>
                <dt>Played</dt>
                <dd>{p.playedSecs} s</dd>
                <dt>Stalls</dt>
                <dd>
                  {p.stalls} ({p.stalledMs} ms)
                </dd>
                <dt>Dropped frames</dt>
                <dd>
                  {p.droppedFrames} / {p.totalFrames}
                </dd>
                <dt>Decoded</dt>
                <dd>{p.decoded}</dd>
                <dt>Min buffer ahead</dt>
                <dd>{p.minBufferAheadSecs.toFixed(1)} s</dd>
                <dt>Frame hitches</dt>
                <dd>
                  {p.hitches} / {p.presentedFrames} (worst {p.worstFrameGapMs} ms)
                </dd>
                <dt>Main-thread jank</dt>
                <dd>
                  {p.longFrames} (worst {p.worstLongFrameMs} ms)
                </dd>
              </dl>
              {p.error ? <p className="mt-2 text-danger">{p.error}</p> : null}
            </div>
          ))}
          <details className="rounded-card border border-line bg-bg-2 p-4 text-sm">
            <summary className="cursor-pointer font-medium">Full report</summary>
            <pre
              className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg-2"
              data-testid="report-text"
            >
              {text}
            </pre>
          </details>
        </>
      ) : null}
    </div>
  )
}
