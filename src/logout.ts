import { type GlobalOptions, clearProfile, resolveConfig } from './config.js'

export interface LogoutOptions {
  revoke?: boolean
}

/** Clears the local session for a profile; `--revoke` also deletes the key server-side first. */
export async function logout(globals: GlobalOptions, options: LogoutOptions): Promise<unknown> {
  const { apiKey, apiKeyId, baseUrl, profile } = resolveConfig(globals)

  let revoked = false
  let warning: string | undefined

  if (options.revoke) {
    if (!apiKey || !apiKeyId) {
      warning = 'No stored API key id for this profile; nothing to revoke server-side.'
    } else {
      try {
        const response = await fetch(`${baseUrl}/api-keys/${apiKeyId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        if (response.ok) {
          revoked = true
        } else {
          warning = `Could not revoke the key server-side (${response.status}): ${(await response.text()) || 'unknown error'}`
        }
      } catch (error) {
        warning = `Could not reach the server to revoke the key: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  const path = clearProfile(profile)

  return { loggedOut: true, profile, revoked, saved: path, ...(warning ? { warning } : {}) }
}
