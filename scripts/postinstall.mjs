// node-pty ships prebuilt binaries; on some installs the macOS/Linux
// spawn-helper loses its executable bit, which makes every spawn fail with
// "posix_spawnp failed". Restore it after every install.
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const prebuilds = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds')
if (existsSync(prebuilds) && process.platform !== 'win32') {
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
