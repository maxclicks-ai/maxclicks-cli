import { type GlobalOptions, clearProfile, resolveConfig } from './config.js'

/**
 * Clears the local session for a profile. Revoking the key itself is done in the maxclicks app,
 * under Settings, Developers: the Public API has no api-keys group, so there is nothing to call.
 */
export async function logout(globals: GlobalOptions): Promise<unknown> {
  const { profile } = resolveConfig(globals)
  const path = clearProfile(profile)

  return { loggedOut: true, profile, saved: path }
}
