// FTP / FTPS (explicit or implicit). basic-ftp runs one command at a time, so
// every public method goes through a small queue.
import * as ftp from 'basic-ftp'
import { PassThrough } from 'node:stream'

export class FtpAdapter {
  constructor(conn) {
    this.conn = conn
    this.secure = conn.type === 'ftps' ? (conn.ftps_implicit ? 'implicit' : true) : false
    this.caps = { chmod: true, resume: true }
    this.queue = Promise.resolve()
  }

  _run(fn) {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => {})
    return next
  }

  async connect() {
    this.client = new ftp.Client(30000)
    await this.client.access({
      host: this.conn.host,
      port: this.conn.port || (this.secure === 'implicit' ? 990 : 21),
      user: this.conn.username || 'anonymous',
      password: this.conn.password || '',
      secure: this.secure,
      // TLS verification on by default; can be disabled per site for self-signed certs.
      secureOptions: this.secure ? { rejectUnauthorized: this.conn.tls_verify !== 0, servername: this.conn.host } : undefined,
    })
  }

  get alive() { return this.client && !this.client.closed }
  async disconnect() { try { this.client?.close() } catch {} }
  async home() { return this._run(() => this.client.pwd()) }

  list(path) {
    return this._run(async () => (await this.client.list(path)).map(i => ({
      name: i.name, path: `${path.replace(/\/+$/, '')}/${i.name}`,
      isDir: i.isDirectory, isLink: i.isSymbolicLink, size: i.size,
      modified: i.modifiedAt ? i.modifiedAt.getTime() : (Date.parse(i.rawModifiedAt) || null),
      mode: i.permissions ? (i.permissions.user << 6) | (i.permissions.group << 3) | i.permissions.world : null,
    })))
  }

  stat(path) {
    return this._run(async () => {
      try {
        const size = await this.client.size(path)
        let modified = null
        try { modified = (await this.client.lastMod(path)).getTime() } catch {}
        return { isDir: false, size, modified }
      } catch {
        try { await this.client.cd(path); await this.client.cd('/'); return { isDir: true, size: 0, modified: null } } catch { return null }
      }
    })
  }

  createReadStream(path, { start = 0 } = {}) {
    const out = new PassThrough()
    this._run(() => this.client.downloadTo(out, path, start)).catch(e => out.destroy(e))
    return out
  }

  upload(path, readable, { append = false } = {}) {
    return this._run(() => append ? this.client.appendFrom(readable, path) : this.client.uploadFrom(readable, path))
  }

  read(path) {
    const chunks = []
    const sink = new PassThrough()
    sink.on('data', c => chunks.push(c))
    return this._run(() => this.client.downloadTo(sink, path)).then(() => Buffer.concat(chunks))
  }

  write(path, buf) {
    const src = new PassThrough(); src.end(buf)
    return this._run(() => this.client.uploadFrom(src, path))
  }

  mkdir(path) { return this._run(async () => { await this.client.ensureDir(path); await this.client.cd('/') }) }
  delete(path, isDir) { return this._run(() => isDir ? this.client.removeDir(path) : this.client.remove(path)) }
  rename(from, to) { return this._run(() => this.client.rename(from, to)) }
  chmod(path, mode) { return this._run(() => this.client.send(`SITE CHMOD ${mode.toString(8)} ${path}`)) }
}
