// VFS entry point: adapter factory plus a small per-user connection pool so
// browsing does not pay an SSH/FTP handshake on every click.
import { config } from '../../config.js'
import { loadConnection } from '../sshConnect.js'
import { SftpAdapter } from './sftp.js'
import { FtpAdapter } from './ftp.js'
import { S3Adapter } from './s3.js'
import { LocalAdapter } from './local.js'
import { ShellAdapter } from './shell.js'

export const LOCAL_ID = 'local'

export function createAdapter(conn, userId) {
  switch (conn.type) {
    case 'ssh':
    case 'sftp': return new SftpAdapter(conn, userId)
    case 'scp': return new ShellAdapter(conn, userId)
    case 'ftp':
    case 'ftps': return new FtpAdapter(conn)
    case 's3': return new S3Adapter(conn)
    default: throw Object.assign(new Error(`File access is not available for ${conn.type} sites`), { statusCode: 400 })
  }
}

/** Fresh, connected adapter (caller must disconnect). `source` is a connection id or 'local'. */
export async function openSource(userId, source, user) {
  if (source === LOCAL_ID || source === null || source === undefined) {
    if (!config.allowLocalShell || (config.mode === 'web' && user?.role !== 'admin')) {
      throw Object.assign(new Error('Local filesystem access is disabled'), { statusCode: 403 })
    }
    return new LocalAdapter()
  }
  const conn = loadConnection(userId, Number(source))
  const adapter = createAdapter(conn, userId)
  await adapter.connect()
  adapter.connection = conn
  return adapter
}

const pool = new Map() // `${userId}:${source}` -> { adapter, timer, pending }
const IDLE_MS = 3 * 60_000

/** Shared adapter for short operations (list/stat/read). */
export async function pooledSource(userId, source, user) {
  const id = `${userId}:${source}`
  const entry = pool.get(id)
  if (entry) {
    const adapter = await entry.pending
    if (adapter.alive) { touch(id); return adapter }
    pool.delete(id)
  }
  const pending = openSource(userId, source, user)
  pool.set(id, { pending, timer: null })
  try {
    const adapter = await pending
    touch(id)
    return adapter
  } catch (e) { pool.delete(id); throw e }
}

function touch(id) {
  const e = pool.get(id)
  if (!e) return
  clearTimeout(e.timer)
  e.timer = setTimeout(async () => { pool.delete(id); (await e.pending.catch(() => null))?.disconnect() }, IDLE_MS)
  e.timer.unref?.()
}

/** Drops pooled adapters for a source (after errors or credential changes). */
export async function evictSource(userId, source) {
  const id = `${userId}:${source}`
  const e = pool.get(id)
  if (!e) return
  pool.delete(id)
  clearTimeout(e.timer);
  (await e.pending.catch(() => null))?.disconnect()
}

export function closePool() { for (const id of [...pool.keys()]) { const [u, s] = id.split(':'); evictSource(Number(u), s) } }
