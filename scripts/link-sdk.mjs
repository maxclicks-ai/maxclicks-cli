import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Supply the sibling SDK checkout as an explicit install input without putting a
// file: dependency back into the release manifest or lockfile.
const directory = mkdtempSync(join(tmpdir(), 'maxclicks-sdk-'))
try {
  execFileSync('npm', ['pack', '--pack-destination', directory], {
    cwd: resolve('../maxclicks-node'),
    stdio: 'inherit',
  })
  const [archive] = readdirSync(directory).filter(name => name.endsWith('.tgz'))
  if (!archive) throw new Error('The SDK build did not produce a tarball.')
  execFileSync(
    'npm',
    [
      'install',
      '--no-save',
      '--package-lock=false',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(directory, archive),
    ],
    {
      stdio: 'inherit',
    }
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}
