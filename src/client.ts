import { Maxclicks } from 'maxclicks'
import { type GlobalOptions, resolveConfig } from './config.js'
import { fail } from './output.js'

/** Builds a configured SDK client from the resolved config, or fails if no API key. */
export function getClient(options: GlobalOptions): Maxclicks {
  const { apiKey, baseUrl } = resolveConfig(options)
  if (!apiKey)
    fail(
      new Error(
        'No API key configured. Run `maxclicks config set-key <key>`, set MAXCLICKS_API_KEY, or pass --api-key.'
      )
    )
  return new Maxclicks({ apiKey, baseUrl })
}
