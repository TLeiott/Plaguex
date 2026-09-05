/** In-memory ring buffer of errors and warnings since app start; included in diagnostics reports. */
export interface LogEntry {
  at: string
  level: 'error' | 'warn' | 'info'
  message: string
}

const MAX = 300
const entries: LogEntry[] = []
let installed = false

export function log(level: LogEntry['level'], message: string) {
  entries.push({ at: new Date().toISOString(), level, message: message.slice(0, 2000) })
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
}

export function logEntries(): LogEntry[] {
  return [...entries]
}

const fmt = (args: unknown[]) =>
  args
    .map((a) =>
      a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safeJson(a),
    )
    .join(' ')

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Hook console.error/warn and global error events. Idempotent. */
export function installLogCapture() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    log('error', fmt(args))
    origError(...args)
  }
  console.warn = (...args: unknown[]) => {
    log('warn', fmt(args))
    origWarn(...args)
  }
  window.addEventListener('error', (e) =>
    log('error', `window.onerror: ${e.message} @ ${e.filename}:${e.lineno}`),
  )
  window.addEventListener('unhandledrejection', (e) =>
    log('error', `unhandledrejection: ${fmt([e.reason])}`),
  )
}
