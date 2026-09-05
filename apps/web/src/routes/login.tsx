import { useEffect, useRef, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import type { Pin } from '@plaguex/plex-api'
import { plexTv } from '@/plex/api'
import { useSession } from '@/plex/session'
import { platform } from '@/platform'
import { Button } from '@/components/ui'

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    const s = useSession.getState()
    if (s.accountToken) throw redirect({ to: s.activeServer ? '/' : '/servers' })
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const signIn = useSession((s) => s.signIn)
  const [pin, setPin] = useState<Pin | null>(null)
  const [status, setStatus] = useState<'idle' | 'waiting' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [openFailed, setOpenFailed] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const start = async () => {
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setError(null)
    setStatus('waiting')
    try {
      const tv = plexTv()
      // The redirect flow needs a strong PIN. If the browser cannot be opened (restricted webview,
      // no browser), fall back to a plain PIN the user types at plex.tv/link on any device.
      let p = await tv.createPin(true)
      setPin(p)
      const opened = await platform()
        .openExternal(p.authUrl)
        .then(
          () => true,
          () => false,
        )
      setOpenFailed(!opened)
      if (!opened) {
        p = await tv.createPin(false)
        setPin(p)
      }
      const token = await tv.waitForPin(p, { signal: ac.signal })
      const user = await tv.user(token)
      signIn(token, user)
      await navigate({ to: '/servers' })
    } catch (e) {
      if (ac.signal.aborted) return
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-8 p-6 safe-px">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src="/favicon.svg" alt="" className="size-16" />
        <h1 className="text-3xl font-bold tracking-tight">Plaguex</h1>
        <p className="max-w-sm text-fg-2">A fast Plex client that gets out of your way.</p>
      </div>

      <div className="w-full max-w-sm rounded-card border border-line bg-bg-2 p-6">
        {status === 'idle' || status === 'error' ? (
          <>
            <p className="text-sm text-fg-2">
              Sign in with your Plex account. A browser window opens for the Plex login; this app
              never sees your password.
            </p>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              className="mt-5 w-full"
              onClick={start}
              data-testid="sign-in"
            >
              Sign in with Plex
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center" aria-live="polite">
            <p className="text-sm text-fg-2">
              {openFailed
                ? 'Could not open a browser. On any device, go to plex.tv/link and enter this code:'
                : 'Approve this device in the browser window that just opened.'}
            </p>
            {pin ? (
              <>
                {openFailed ? (
                  <p
                    className="font-mono text-3xl font-bold tracking-[0.3em]"
                    data-testid="pin-code"
                  >
                    {pin.code}
                  </p>
                ) : (
                  <p className="text-xs text-fg-3" data-testid="pin-code">
                    Signed in already? It can take a few seconds to register here.
                  </p>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => platform().openExternal(pin.authUrl)}
                >
                  <ExternalLink className="size-4" /> Open login page again
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" loading>
              Waiting for approval
            </Button>
          </div>
        )}
      </div>
    </main>
  )
}
