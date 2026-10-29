import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_BASE_URL = 'https://api.maxclicks.ai/v1'
const DEFAULT_WEB_ORIGIN = 'https://app.maxclicks.ai'

export const LOGIN_TIMEOUT_MILLISECONDS = 5 * 60 * 1000
export const LOGIN_POLL_INTERVAL_MILLISECONDS = 2 * 1000
export const LOGIN_CALLBACK_MAXIMUM_BODY_BYTES = 16 * 1024
export const DEFAULT_LIST_PAGE_SIZE = 50
export const CREATE_CLI_PAIRING_PATH = '/any/account/create-cli-pairing'
export const CLAIM_CLI_PAIRING_PATH = '/any/account/claim-cli-pairing'

export interface Profile {
  apiKey?: string
  apiKeyId?: string
  baseUrl?: string
  webOrigin?: string
}

export interface ResolvedConfig {
  apiKey: string | null
  apiKeyId: string | null
  baseUrl: string
  privateBaseUrl: string
  webOrigin: string
  profile: string
}

export interface GlobalOptions {
  apiKey?: string
  baseUrl?: string
  webOrigin?: string
  profile?: string
}

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'maxclicks')
}

export function getConfigPath(): string {
  return join(configDir(), 'config.json')
}

function readConfigFile(): Record<string, Profile> {
  try {
    return JSON.parse(readFileSync(getConfigPath(), 'utf8')) as Record<string, Profile>
  } catch {
    return {}
  }
}

/** `mode` applies only when a file is created, so an existing file is narrowed again after every write. */
function writeConfigFile(all: Record<string, Profile>): string {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  writeFileSync(getConfigPath(), JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
  chmodSync(getConfigPath(), 0o600)
  return getConfigPath()
}

function writeProfile(profile: string, patch: (current: Profile) => Profile): string {
  const all = readConfigFile()
  all[profile] = patch(all[profile] ?? {})
  return writeConfigFile(all)
}

/** Persists an API key (and optional base URL) for a profile at ~/.config/maxclicks/config.json. */
export function writeApiKey(profile: string, apiKey: string, baseUrl?: string): string {
  return writeProfile(profile, current => ({ ...current, apiKey, ...(baseUrl ? { baseUrl } : {}) }))
}

/** Persists a full login session (key, its id, and the base URL it was minted against) for a profile. */
export function writeSession(
  profile: string,
  session: { apiKey: string; apiKeyId: string; baseUrl?: string }
): string {
  return writeProfile(profile, current => ({
    ...current,
    apiKey: session.apiKey,
    apiKeyId: session.apiKeyId,
    ...(session.baseUrl ? { baseUrl: session.baseUrl } : {}),
  }))
}

/** Removes a profile's stored credentials entirely. */
export function clearProfile(profile: string): string {
  const all = readConfigFile()
  delete all[profile]
  return writeConfigFile(all)
}

/** Resolves the effective config: flags override env, which overrides the config file. */
export function resolveConfig(options: GlobalOptions): ResolvedConfig {
  const profile = options.profile || process.env.MAXCLICKS_PROFILE || 'default'
  const file = readConfigFile()[profile] ?? {}
  const apiKey = options.apiKey || process.env.MAXCLICKS_API_KEY || file.apiKey || null
  const apiKeyId = file.apiKeyId || null
  const baseUrl = options.baseUrl || process.env.MAXCLICKS_BASE_URL || file.baseUrl || DEFAULT_BASE_URL
  const webOrigin = options.webOrigin || process.env.MAXCLICKS_WEB_ORIGIN || file.webOrigin || DEFAULT_WEB_ORIGIN
  return { apiKey, apiKeyId, baseUrl, privateBaseUrl: derivePrivateBaseUrl(baseUrl), webOrigin, profile }
}

function derivePrivateBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return /\/v1$/.test(trimmed) ? trimmed.replace(/\/v1$/, '/private') : `${trimmed}/private`
}

/** Masks a key for display: keeps the first 6 and last 4 characters. */
export function maskKey(apiKey: string | null): string | null {
  if (!apiKey) return null
  if (apiKey.length <= 12) return '****'
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
}
