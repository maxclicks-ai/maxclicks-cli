import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_BASE_URL = 'https://api.maxclicks.ai/v1'

export interface Profile {
  apiKey?: string
  baseUrl?: string
}

export interface ResolvedConfig {
  apiKey: string | null
  baseUrl: string
  profile: string
}

export interface GlobalOptions {
  apiKey?: string
  baseUrl?: string
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

/** Persists an API key (and optional base URL) for a profile at ~/.config/maxclicks/config.json. */
export function writeApiKey(profile: string, apiKey: string, baseUrl?: string): string {
  const dir = configDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const all = readConfigFile()
  all[profile] = { ...all[profile], apiKey, ...(baseUrl ? { baseUrl } : {}) }
  writeFileSync(getConfigPath(), JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
  return getConfigPath()
}

/** Resolves the effective config: flags override env, which overrides the config file. */
export function resolveConfig(options: GlobalOptions): ResolvedConfig {
  const profile = options.profile || process.env.MAXCLICKS_PROFILE || 'default'
  const file = readConfigFile()[profile] ?? {}
  const apiKey = options.apiKey || process.env.MAXCLICKS_API_KEY || file.apiKey || null
  const baseUrl = options.baseUrl || process.env.MAXCLICKS_BASE_URL || file.baseUrl || DEFAULT_BASE_URL
  return { apiKey, baseUrl, profile }
}

/** Masks a key for display: keeps the first 6 and last 4 characters. */
export function maskKey(apiKey: string | null): string | null {
  if (!apiKey) return null
  if (apiKey.length <= 12) return '****'
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
}
