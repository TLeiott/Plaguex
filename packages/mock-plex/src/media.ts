import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

export function mediaPath(...parts: string[]): string {
  return join(assets, ...parts)
}

export async function mediaResponse(
  request: Request,
  path: string,
  contentType: string,
  disposition?: string,
): Promise<Response> {
  const body = await readFile(path)
  const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Content-Type': contentType })
  if (disposition) headers.set('Content-Disposition', disposition)
  const range = request.headers.get('range')
  if (!range) {
    headers.set('Content-Length', String(body.length))
    return new Response(body, { headers })
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match)
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${body.length}` },
    })
  const suffixLength = !match[1] && match[2] ? Number(match[2]) : undefined
  const start =
    suffixLength === undefined ? Number(match[1]) : Math.max(body.length - suffixLength, 0)
  if (!Number.isFinite(start) || start >= body.length)
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${body.length}` },
    })
  const requestedEnd = suffixLength === undefined && match[2] ? Number(match[2]) : body.length - 1
  const end = Math.min(Math.max(requestedEnd, start), body.length - 1)
  const slice = body.subarray(start, end + 1)
  headers.set('Content-Length', String(slice.length))
  headers.set('Content-Range', `bytes ${start}-${end}/${body.length}`)
  return new Response(slice, { status: 206, headers })
}
