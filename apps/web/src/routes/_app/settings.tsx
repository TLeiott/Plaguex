import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { DOWNLOAD_PRESETS, type PlayerCapabilities } from '@plaguex/plex-api'
import { useSession, type Settings } from '@/plex/session'
import { plexTv } from '@/plex/api'
import { Button, buttonClass } from '@/components/ui'
import { platform } from '@/platform'
import { APP_VERSION } from '@/plex/client-info'

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage })

const QUALITIES: { label: string; kbps: number | undefined }[] = [
  { label: 'Original (no transcoding unless required)', kbps: undefined },
  { label: '20 Mbps 1080p', kbps: 20000 },
  { label: '12 Mbps 1080p', kbps: 12000 },
  { label: '8 Mbps 1080p', kbps: 8000 },
  { label: '4 Mbps 720p', kbps: 4000 },
  { label: '2 Mbps 720p', kbps: 2000 },
]

function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: keyof Settings
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span>
        <span className="block font-medium">{label}</span>
        {description ? <span className="block text-sm text-fg-3">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        className="mt-1 size-5 accent-accent"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={`setting-${id}`}
      />
    </label>
  )
}

function SettingsPage() {
  const navigate = useNavigate()
  const { settings, updateSettings, user, activeServer, accountToken, signOut } = useSession()
  const [caps, setCaps] = useState<PlayerCapabilities | null>(null)
  useEffect(() => {
    void platform().probeCapabilities().then(setCaps)
  }, [])

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-6 safe-px"
      data-testid="settings-page"
    >
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-3">Playback</h2>
        <div className="divide-y divide-line rounded-card border border-line bg-bg-2 px-4">
          <label className="flex items-center justify-between gap-4 py-3">
            <span>
              <span className="block font-medium">Streaming quality</span>
              <span className="block text-sm text-fg-3">
                Caps bitrate when the server has to transcode.
              </span>
            </span>
            <select
              value={settings.maxBitrateKbps ?? ''}
              onChange={(e) =>
                updateSettings(
                  e.target.value
                    ? { maxBitrateKbps: Number(e.target.value) }
                    : { maxBitrateKbps: undefined },
                )
              }
              className="h-9 max-w-[50%] rounded-lg border border-line bg-bg-3 px-2 text-sm"
              data-testid="setting-quality"
            >
              {QUALITIES.map((o) => (
                <option key={o.label} value={o.kbps ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-4 py-3">
            <span>
              <span className="block font-medium">Maximum resolution</span>
              <span className="block text-sm text-fg-3">
                Sources above this are downscaled by the server.
              </span>
            </span>
            <select
              value={settings.maxHeight ?? ''}
              onChange={(e) =>
                updateSettings(
                  e.target.value ? { maxHeight: Number(e.target.value) } : { maxHeight: undefined },
                )
              }
              className="h-9 max-w-[50%] rounded-lg border border-line bg-bg-3 px-2 text-sm"
              data-testid="setting-max-height"
            >
              <option value="">Original</option>
              <option value="2160">4K (2160p)</option>
              <option value="1440">1440p</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-4 py-3">
            <span>
              <span className="block font-medium">Download quality</span>
              <span className="block text-sm text-fg-3">
                Original keeps the server file; presets re-encode to save space.
              </span>
            </span>
            <select
              value={settings.downloadQuality}
              onChange={(e) => updateSettings({ downloadQuality: e.target.value })}
              className="h-9 max-w-[50%] rounded-lg border border-line bg-bg-3 px-2 text-sm"
              data-testid="setting-download-quality"
            >
              <option value="ask">Ask every time</option>
              <option value="original">Original file</option>
              {DOWNLOAD_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <Toggle
            id="autoSkipIntro"
            label="Skip intros automatically"
            checked={settings.autoSkipIntro}
            onChange={(v) => updateSettings({ autoSkipIntro: v })}
          />
          <Toggle
            id="autoSkipCredits"
            label="Skip credits automatically"
            checked={settings.autoSkipCredits}
            onChange={(v) => updateSettings({ autoSkipCredits: v })}
          />
          <Toggle
            id="autoPlayNext"
            label="Auto-play next episode"
            checked={settings.autoPlayNext}
            onChange={(v) => updateSettings({ autoPlayNext: v })}
          />
          {platform().nativeVideo ? (
            <Toggle
              id="nativePlayer"
              label="Native video player"
              description="Renders video with the system's hardware player (ExoPlayer) for smooth frame pacing, embedded subtitles and HDR. Turn off to use the web player."
              checked={settings.nativePlayer}
              onChange={(v) => updateSettings({ nativePlayer: v })}
            />
          ) : null}
          {platform().externalPlayer ? (
            <Toggle
              id="externalPlayer"
              label="Play with mpv"
              description="Direct plays every file and renders all subtitle formats natively. Opens in its own window."
              checked={settings.externalPlayer}
              onChange={(v) => updateSettings({ externalPlayer: v })}
            />
          ) : null}
          <Toggle
            id="subtitlesOnByDefault"
            label="Subtitles on by default"
            description="Uses the track Plex has selected for the item."
            checked={settings.subtitlesOnByDefault}
            onChange={(v) => updateSettings({ subtitlesOnByDefault: v })}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-3">
          This device
        </h2>
        <div className="rounded-card border border-line bg-bg-2 p-4 text-sm">
          <p className="text-fg-2">
            Plaguex {APP_VERSION} · {platform().kind}
          </p>
          {caps ? (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-fg-2">
              <dt className="text-fg-3">Containers</dt>
              <dd>{caps.containers.join(', ') || 'none'}</dd>
              <dt className="text-fg-3">Video</dt>
              <dd>{caps.videoCodecs.join(', ') || 'none'}</dd>
              <dt className="text-fg-3">Audio</dt>
              <dd>{caps.audioCodecs.join(', ') || 'none'}</dd>
              <dt className="text-fg-3">HDR</dt>
              <dd>{caps.hdr ? 'yes' : 'no (server tone-maps)'}</dd>
            </dl>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-3">Debug</h2>
        <div className="rounded-card border border-line bg-bg-2 p-4 text-sm">
          <p className="text-fg-2">
            Runs every part of the app against your server and device (connections, library, images,
            downloads, playback with stutter measurements) and produces a report you can share.
          </p>
          <Link
            to="/diagnostics"
            className={`${buttonClass('secondary', 'md')} mt-3`}
            data-testid="open-diagnostics"
          >
            Diagnostics &amp; benchmark
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-3">Account</h2>
        <div className="flex flex-col gap-3 rounded-card border border-line bg-bg-2 p-4 text-sm">
          <p>
            <span className="text-fg-3">Signed in as </span>
            {user?.title} {user?.plexPass ? <span className="text-accent">· Plex Pass</span> : null}
          </p>
          <p>
            <span className="text-fg-3">Server </span>
            {activeServer?.name} <span className="text-fg-3">({activeServer?.baseUrl})</span>
          </p>
          <div className="flex gap-2">
            <Button onClick={() => navigate({ to: '/servers' })}>Switch server</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (accountToken) void plexTv().signOut(accountToken)
                signOut()
                void navigate({ to: '/login' })
              }}
              data-testid="sign-out"
            >
              Sign out
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
