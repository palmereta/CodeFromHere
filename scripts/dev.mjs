// Runs the API (with --watch) and the Vite dev server together.
import { spawn } from 'node:child_process'
const procs = [
  spawn(process.execPath, ['--watch', 'server.js'], { stdio: 'inherit', env: { ...process.env, ALLOW_LOCAL_SHELL: process.env.ALLOW_LOCAL_SHELL ?? '1' } }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite'], { stdio: 'inherit', shell: process.platform === 'win32' }),
]
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', stop)
