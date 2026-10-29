import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { hostname, platform } from 'node:os'
import {
  CLAIM_CLI_PAIRING_PATH,
  CREATE_CLI_PAIRING_PATH,
  LOGIN_CALLBACK_MAXIMUM_BODY_BYTES,
  LOGIN_POLL_INTERVAL_MILLISECONDS,
  LOGIN_TIMEOUT_MILLISECONDS,
  resolveConfig,
  writeSession,
  type GlobalOptions,
} from './config.js'
import { fail } from './output.js'

export interface LoginOptions {
  browser?: boolean
}

interface MintedKey {
  key: string
  apiKeyId: string
}

export async function login(globals: GlobalOptions, options: LoginOptions): Promise<unknown> {
  const { baseUrl, privateBaseUrl, webOrigin, profile } = resolveConfig(globals)
  const useBrowser = options.browser !== false
  const name = hostname()

  const state = randomBytes(32).toString('hex')
  const stateHash = createHash('sha256').update(state).digest('hex')

  const pairResponse = await fetch(`${privateBaseUrl}${CREATE_CLI_PAIRING_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stateHash, name }),
  })
  if (!pairResponse.ok)
    fail(new Error(`Failed to start login (${pairResponse.status}): ${(await pairResponse.text()) || 'unknown error'}`))
  const { pairingId } = (await pairResponse.json()) as { pairingId: string }

  const callback = useBrowser ? await startCallbackServer(state, new URL(webOrigin).origin) : null

  const authorizeUrl = new URL('/cli/authorize', webOrigin)
  authorizeUrl.searchParams.set('pairingId', pairingId)
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('name', name)
  if (callback) authorizeUrl.searchParams.set('callback', `http://127.0.0.1:${callback.port}/callback`)

  if (useBrowser) {
    process.stderr.write(`Opening your browser to finish signing in...\n${authorizeUrl.href}\n`)
    openBrowser(authorizeUrl.href)
  } else {
    process.stderr.write(`Open this URL to finish signing in:\n${authorizeUrl.href}\n`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('Login timed out after 5 minutes.')),
    LOGIN_TIMEOUT_MILLISECONDS
  )

  const pollPromise = pollForKey(privateBaseUrl, pairingId, state, controller.signal)
  pollPromise.catch(() => {})
  const callbackPromise = callback?.waitForKey(controller.signal)
  callbackPromise?.catch(() => {})

  try {
    const minted = await Promise.race([pollPromise, ...(callbackPromise ? [callbackPromise] : [])])

    const path = writeSession(profile, { apiKey: minted.key, apiKeyId: minted.apiKeyId, baseUrl })
    return { loggedIn: true, profile, apiKeyId: minted.apiKeyId, baseUrl, saved: path }
  } catch (error) {
    fail(error)
  } finally {
    clearTimeout(timeout)
    controller.abort()
    callback?.close()
  }
}

async function pollForKey(
  privateBaseUrl: string,
  pairingId: string,
  state: string,
  signal: AbortSignal
): Promise<MintedKey> {
  for (;;) {
    if (signal.aborted) throw asError(signal.reason, 'Login was cancelled.')

    const response = await fetch(`${privateBaseUrl}${CLAIM_CLI_PAIRING_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingId, state }),
      signal,
    })
    if (response.ok) {
      const body = (await response.json()) as { status: string; key?: string; apiKeyId?: string }
      if (body.status === 'approved' && body.key && body.apiKeyId) return { key: body.key, apiKeyId: body.apiKeyId }
      if (body.status === 'denied') throw new Error('Login was denied in the browser.')
      if (body.status === 'expired') throw new Error('Login request expired. Run `maxclicks login` again.')
    }

    await sleep(LOGIN_POLL_INTERVAL_MILLISECONDS, signal)
  }
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(asError(signal.reason, 'Login was cancelled.'))
    const timeout = setTimeout(resolve, milliseconds)
    const onAbort = () => {
      clearTimeout(timeout)
      reject(asError(signal.reason, 'Login was cancelled.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function asError(reason: unknown, fallbackMessage: string): Error {
  return reason instanceof Error ? reason : new Error(fallbackMessage)
}

interface CallbackServer {
  port: number
  waitForKey: (signal: AbortSignal) => Promise<MintedKey>
  close: () => void
}

/**
 * The loopback listener accepts a key only from the web app's origin and only with this login's state, so a page
 * open in another tab cannot hand the CLI a key for a workspace the user never chose. Polling stays the fallback.
 */
function startCallbackServer(state: string, webOrigin: string): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let resolveKey: (value: MintedKey) => void = () => {}
    let rejectKey: (error: Error) => void = () => {}
    const keyPromise = new Promise<MintedKey>((res, rej) => {
      resolveKey = res
      rejectKey = rej
    })
    keyPromise.catch(() => {})

    const server: Server = createServer((request, response) => {
      const corsHeaders = {
        'Access-Control-Allow-Origin': webOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      }

      if (request.headers.origin !== webOrigin) {
        response.writeHead(403, corsHeaders).end()
        return
      }

      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders).end()
        return
      }

      if (request.method !== 'POST' || request.url !== '/callback') {
        response.writeHead(404, corsHeaders).end()
        return
      }

      let body = ''
      request.on('data', chunk => {
        body += chunk
        if (body.length > LOGIN_CALLBACK_MAXIMUM_BODY_BYTES) request.destroy()
      })
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { key?: string; apiKeyId?: string; state?: string }
          if (!parsed.key || !parsed.apiKeyId || !matchesState(parsed.state, state))
            throw new Error('Missing key or state in callback payload.')
          response.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }))
          resolveKey({ key: parsed.key, apiKeyId: parsed.apiKeyId })
        } catch {
          response.writeHead(400, corsHeaders).end()
        }
      })
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind the loopback callback listener.'))
        return
      }
      resolve({
        port: address.port,
        waitForKey: signal =>
          new Promise((res, rej) => {
            if (signal.aborted) return rej(asError(signal.reason, 'Login was cancelled.'))
            signal.addEventListener('abort', () => rej(asError(signal.reason, 'Login was cancelled.')), { once: true })
            keyPromise.then(res, rej)
          }),
        close: () => {
          rejectKey(new Error('Loopback callback listener closed.'))
          server.close()
        },
      })
    })
  })
}

function matchesState(presented: string | undefined, expected: string): boolean {
  if (typeof presented !== 'string') return false
  const presentedHash = createHash('sha256').update(presented).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(presentedHash, expectedHash)
}

function openBrowser(url: string): void {
  try {
    const target = platform()
    const command = target === 'darwin' ? 'open' : target === 'win32' ? 'cmd' : 'xdg-open'
    const args = target === 'win32' ? ['/c', 'start', '""', url] : [url]
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    void url
  }
}
