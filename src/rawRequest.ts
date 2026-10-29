import { type GlobalOptions, resolveConfig } from './config.js'
import { fail } from './output.js'

/**
 * Escape hatch: makes a raw authenticated request to any API path and returns
 * `{ status, body }`, exiting non-zero on a non-2xx status. Used by `maxclicks api <method> <path>`.
 */
export async function rawRequest(
  options: GlobalOptions,
  method: string,
  path: string,
  dataString?: string
): Promise<{ status: number; body: unknown }> {
  const { apiKey, baseUrl } = resolveConfig(options)
  if (!apiKey) fail(new Error('No API key configured. Run `maxclicks config set-key <key>` or set MAXCLICKS_API_KEY.'))

  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  let body: string | undefined
  if (dataString !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = dataString
  }

  const response = await fetch(url, { method: method.toUpperCase(), headers, body })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = text.length ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  if (!response.ok) process.exitCode = 1
  return { status: response.status, body: parsed }
}
