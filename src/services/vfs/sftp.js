// SFTP over ssh2 directly (no wrapper) so we get host-key pinning, jump hosts,
// agents, ranged reads and appends for resumable transfers.
import { connectSsh } from '../sshConnect.js'

const p = (fn) => new Promise((res, rej) => fn((e, v) => (e ? rej(e) : res(v))))
const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFLNK = 0o120000

export class SftpAdapter {
  constructor(conn, userId) { this.conn = conn; this.userId = userId; this.caps = { chmod: true, resume: true, symlinks: true } }

  async connect() {
    this.client = await connectSsh(this.conn, this.userId)
    this.sftp = await p((cb) => this.client.sftp(cb))
    this.client.on('close', () => { this.closed = true })
  }

  async disconnect() { try { this.client?.end() } catch {} }

  get alive() { return !!this.client && !this.closed }

  async home() { return p((cb) => this.sftp.realpath('.', cb)) }

  async list(path) {
    const entries = await p((cb) => this.sftp.readdir(path, cb))
    const base = path.replace(/\/+$/, '')
    const items = await Promise.all(entries.map(async (e) => {
      const type = e.attrs.mode & S_IFMT
      let isDir = type === S_IFDIR
      const isLink = type === S_IFLNK
      if (isLink) { try { isDir = ((await p((cb) => this.sftp.stat(`${base}/${e.filename}`, cb))).mode & S_IFMT) === S_IFDIR } catch {} }
      return {
        name: e.filename, path: `${base}/${e.filename}`, isDir, isLink,
        size: e.attrs.size, modified: e.attrs.mtime * 1000, mode: e.attrs.mode & 0o7777,
        owner: e.attrs.uid, group: e.attrs.gid,
      }
    }))
    return items
  }

  async stat(path) {
    try {
      const s = await p((cb) => this.sftp.stat(path, cb))
      return { isDir: (s.mode & S_IFMT) === S_IFDIR, size: s.size, modified: s.mtime * 1000, mode: s.mode & 0o7777 }
    } catch (e) { if (e.code === 2) return null; throw e }
  }

  createReadStream(path, { start = 0 } = {}) { return this.sftp.createReadStream(path, { start }) }

  async upload(path, readable, { append = false } = {}) {
    const ws = this.sftp.createWriteStream(path, append ? { flags: 'a' } : { flags: 'w' })
    await new Promise((res, rej) => {
      readable.on('error', rej)
      ws.on('error', rej)
      ws.on('close', res)
      readable.pipe(ws)
    })
  }

  async read(path) { return p((cb) => this.sftp.readFile(path, cb)) }
  async write(path, buf) { return p((cb) => this.sftp.writeFile(path, buf, cb)) }

  async mkdir(path) {
    const parts = path.split('/').filter(Boolean)
    let cur = path.startsWith('/') ? '' : '.'
    for (const part of parts) {
      cur += '/' + part
      const st = await this.stat(cur)
      if (!st) await p((cb) => this.sftp.mkdir(cur, cb))
    }
  }

  async delete(path, isDir) {
    if (!isDir) return p((cb) => this.sftp.unlink(path, cb))
    for (const item of await this.list(path)) await this.delete(item.path, item.isDir && !item.isLink)
    return p((cb) => this.sftp.rmdir(path, cb))
  }

  async rename(from, to) { return p((cb) => this.sftp.rename(from, to, cb)) }
  async chmod(path, mode) { return p((cb) => this.sftp.chmod(path, mode, cb)) }
  async setModified(path, ms) { const t = Math.floor(ms / 1000); return p((cb) => this.sftp.utimes(path, t, t, cb)) }
}
