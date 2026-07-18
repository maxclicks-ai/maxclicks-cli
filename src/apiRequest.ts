import { MaxclicksError } from 'maxclicks'
import { DEFAULT_LIST_PAGE_SIZE, type GlobalOptions, resolveConfig } from './config.js'
import { fail } from './output.js'

export interface ApiRequest {
  method: string
  path: string
  query?: Record<string, unknown>
  body?: unknown
  idempotencyKey?: string
}

interface Envelope {
  data?: unknown
  pagination?: Record<string, unknown>
  warnings?: unknown
}

interface RawResult {
  ok: boolean
  status: number
  text: string
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item))
    else params.append(key, String(value))
  }
  const string = params.toString()
  return string ? `?${string}` : ''
}

async function send(options: GlobalOptions, request: ApiRequest): Promise<RawResult> {
  const { apiKey, baseUrl } = resolveConfig(options)
  if (!apiKey)
    fail(
      new Error(
        'No API key configured. Run `maxclicks config set-key <key>`, set MAXCLICKS_API_KEY, or pass --api-key.'
      )
    )

  const path = request.path.startsWith('/') ? request.path : `/${request.path}`
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  let body: string | undefined
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(request.body)
  }
  if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey

  const response = await fetch(`${baseUrl}${path}${buildQuery(request.query)}`, {
    method: request.method.toUpperCase(),
    headers,
    body,
  })
  return { ok: response.ok, status: response.status, text: await response.text() }
}

function parseEnvelope(result: RawResult): Envelope {
  let parsed: unknown = null
  try {
    parsed = result.text.length ? JSON.parse(result.text) : null
  } catch {
    parsed = result.text
  }
  if (!result.ok) {
    const error = (parsed as { error?: { code?: string | null; type?: string | null; message?: string } } | null)?.error
    throw new MaxclicksError(error?.message ?? `Request failed with status ${result.status}.`, {
      status: result.status,
      code: error?.code ?? null,
      type: error?.type ?? null,
      raw: parsed,
    })
  }
  return (parsed ?? {}) as Envelope
}

/**
 * Makes a raw authenticated request to an API path the vendored SDK does not
 * cover. Unwraps the `{ data }` envelope so callers print the resource directly,
 * and throws a `MaxclicksError` (rendered as structured JSON by `fail`) on any
 * non-2xx response.
 */
export async function apiRequest(options: GlobalOptions, request: ApiRequest): Promise<unknown> {
  const envelope = parseEnvelope(await send(options, request))
  return envelope.data !== undefined ? envelope.data : envelope
}

/**
 * Makes a raw authenticated request and returns the response body verbatim as
 * text (for endpoints that stream non-JSON payloads, e.g. an import's CSV
 * failure log). Throws a `MaxclicksError` on any non-2xx response.
 */
export async function apiRequestText(options: GlobalOptions, request: ApiRequest): Promise<string> {
  const result = await send(options, request)
  if (!result.ok) parseEnvelope(result)
  return result.text
}

export interface ListParams {
  limit?: number
  offset?: number
  all?: boolean
  query?: Record<string, unknown>
}

/**
 * Fetches an offset-paginated list. Without `all`, returns one page as
 * `{ data, pagination, warnings }`; with `all`, walks every page (advancing
 * `offset` until `pagination.hasMore` is false) and returns the flat array.
 */
export async function apiList(options: GlobalOptions, path: string, params: ListParams): Promise<unknown> {
  const query = { ...params.query }
  if (!params.all) {
    const envelope = parseEnvelope(
      await send(options, { method: 'GET', path, query: { ...query, limit: params.limit, offset: params.offset } })
    )
    return { data: envelope.data, pagination: envelope.pagination, warnings: envelope.warnings }
  }

  const pageSize = params.limit ?? DEFAULT_LIST_PAGE_SIZE
  let offset = params.offset ?? 0
  const all: unknown[] = []
  for (;;) {
    const envelope = parseEnvelope(await send(options, { method: 'GET', path, query: { ...query, limit: pageSize, offset } }))
    all.push(...((envelope.data as unknown[] | undefined) ?? []))
    const pagination = envelope.pagination as { hasMore?: boolean } | undefined
    if (!pagination?.hasMore) break
    offset += pageSize
  }
  return all
}

export interface CursorListParams {
  limit?: number
  cursor?: string
  all?: boolean
  query?: Record<string, unknown>
}

/**
 * Fetches a cursor-paginated list (only `events.list`). Without `all`, returns
 * one page as `{ data, pagination, warnings }`; with `all`, follows
 * `pagination.nextCursor` until exhausted and returns the flat array.
 */
export async function apiListCursor(options: GlobalOptions, path: string, params: CursorListParams): Promise<unknown> {
  const query = { ...params.query }
  if (!params.all) {
    const envelope = parseEnvelope(
      await send(options, { method: 'GET', path, query: { ...query, limit: params.limit, cursor: params.cursor } })
    )
    return { data: envelope.data, pagination: envelope.pagination, warnings: envelope.warnings }
  }

  const all: unknown[] = []
  let cursor = params.cursor
  for (;;) {
    const envelope = parseEnvelope(await send(options, { method: 'GET', path, query: { ...query, limit: params.limit, cursor } }))
    all.push(...((envelope.data as unknown[] | undefined) ?? []))
    const pagination = envelope.pagination as { hasMore?: boolean; nextCursor?: string | null } | undefined
    if (!pagination?.hasMore || !pagination.nextCursor) break
    cursor = pagination.nextCursor
  }
  return all
}
