/**
 * Obtain a Plex account token for local development / live verification.
 * Usage: pnpm plex:login   -> prints a URL, waits for approval, writes .env.local (gitignored).
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PlexTv } from '../packages/plex-api/src/index.ts'

const envPath = new URL('../.env.local', import.meta.url)
const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
const cid = /PLEX_CLIENT_ID=(.+)/.exec(existing)?.[1]?.trim() ?? randomUUID()

const tv = new PlexTv({
  clientIdentifier: cid,
  product: 'Plaguex',
  version: 'dev',
  platform: 'Linux',
  device: 'Linux',
  deviceName: 'Plaguex dev CLI',
})

const pin = await tv.createPin()
console.log('\nOpen this URL and approve the device:\n')
console.log(`  ${pin.authUrl}\n`)
console.log(
  `(or go to https://plex.tv/link and enter ${pin.code}; expires ${pin.expiresAt.toLocaleTimeString()})\n`,
)

const token = await tv.waitForPin(pin, { intervalMs: 3000 })
const user = await tv.user(token)
const servers = await tv.servers(token)

const lines = [
  `PLEX_CLIENT_ID=${cid}`,
  `PLEX_TOKEN=${token}`,
  ...servers.map(
    (s, i) =>
      `# server ${i}: ${s.name} (${s.owned ? 'owned' : 'shared'}) token=${s.accessToken ?? '-'} uris=${s.connections.map((c) => c.uri).join(',')}`,
  ),
]
writeFileSync(envPath, lines.join('\n') + '\n')
console.log(`Signed in as ${user.title}. Found ${servers.length} server(s):`)
for (const s of servers)
  console.log(
    `  - ${s.name}: ${s.connections.map((c) => `${c.uri}${c.local ? ' (local)' : c.relay ? ' (relay)' : ''}`).join(', ')}`,
  )
console.log(`\nWrote ${envPath.pathname}`)
