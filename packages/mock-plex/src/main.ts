import { serve } from '@hono/node-server'
import { createMockPlex } from './server'

const port = Number(process.env.PORT ?? 32400)
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}`
const autoClaim = process.env.PIN_AUTO_CLAIM_AFTER
  ? Number(process.env.PIN_AUTO_CLAIM_AFTER)
  : undefined
const { app } = createMockPlex({
  baseUrl,
  ...(autoClaim !== undefined ? { plexTvPinAutoClaimAfter: autoClaim } : {}),
})

serve({ fetch: app.fetch, port }, () => console.log(`Mock Plex listening at ${baseUrl}`))
