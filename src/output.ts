import { MaxclicksError } from 'maxclicks'

/** Prints a JSON value to stdout (the machine-readable channel agents parse). */
export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data ?? null, null, 2) + '\n')
}

/** Prints a structured error to stderr and exits non-zero. */
export function fail(error: unknown): never {
  const body =
    error instanceof MaxclicksError
      ? { error: { status: error.status, code: error.code, type: error.type, message: error.message } }
      : { error: { message: error instanceof Error ? error.message : String(error) } }
  process.stderr.write(JSON.stringify(body, null, 2) + '\n')
  process.exit(1)
}

/** Parses a `--data` JSON argument, failing with a clear message on invalid JSON. */
export function parseData(input: string | undefined, label = '--data'): unknown {
  if (input === undefined) return undefined
  try {
    return JSON.parse(input)
  } catch (error) {
    fail(new Error(`Invalid JSON for ${label}: ${error instanceof Error ? error.message : String(error)}`))
  }
}

/** Wraps an async command body: prints its result as JSON, or fails cleanly. */
export function action<A extends unknown[]>(run: (...args: A) => Promise<unknown>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      printJson(await run(...args))
    } catch (error) {
      fail(error)
    }
  }
}
