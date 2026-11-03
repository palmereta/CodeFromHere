// "SCP" sites: file access through the remote shell (for servers where the
// SFTP subsystem is disabled). Uses POSIX tools over an SSH exec channel.
import { connectSsh } from '../sshConnect.js'
import { posixQuote as q } from '../../sessions/agents.js'
import * as streamMod from 'node:stream'

export class ShellAdapter {
  constructor(conn, userId) { this.conn = conn; this.userId = userId; this.caps = { chmod: true, resume: false } }

  async connect() { this.client = await connectSsh(this.conn, this.userId); this.client.on('close', () => { this.closed = true }) }
  async disconnect() { try { this.client?.end() } catch {} }
  get alive() { return !!this.client && !this.closed }

  _exec(cmd, input) {
    return new Promise((resolve, reject) => {
      this.client.exec(cmd, (err, stream) => {
        if (err) return reject(err)
        const out = [], errOut = []
        stream.on('data', d => out.push(d))
        stream.stderr.on('data', d => errOut.push(d))
        stream.on('close', (code) => code === 0 ? resolve(Buffer.concat(out))
          : reject(new Error(Buffer.concat(errOut).toString().trim() || `exit ${code}`)))
        if (input !== undefined) stream.end(input)
      })
    })
  }

  async home() { return (await this._exec('pwd')).toString().trim() }

  async list(path) {
    // GNU find gives a reliable machine-readable listing; BSD falls back to stat.
    const cmd = `cd ${q(path)} && (find . -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%m\\t%f\\n' 2>/dev/null || ` +
      `for f in .[!.]* ..?* *; do [ -e "$f" ] || [ -L "$f" ] || continue; stat -f '%HT%t%z%t%m%t%Lp%t%N' "$f"; done)`
    const text = (await this._exec(cmd)).toString()
    const base = path.replace(/\/+$/, '')
    return text.split('\n').filter(Boolean).map(line => {
      const [t, size, mtime, mode, ...rest] = line.split('\t')
      const name = rest.join('\t').replace(/^\.\//, '')
      const isDir = t === 'd' || t === 'Directory'
      return { name, path: `${base}/${name}`, isDir, isLink: t === 'l' || t === 'Symbolic Link', size: Number(size), modified: Number(mtime) * 1000, mode: parseInt(mode, 8) }
    })
  }

  async stat(path) {
    try {
      const out = (await this._exec(`stat -c '%F\t%s\t%Y' ${q(path)} 2>/dev/null || stat -f '%HT%t%z%t%m' ${q(path)}`)).toString().trim()
      const [t, size, mtime] = out.split('\t')
      return { isDir: /directory/i.test(t), size: Number(size), modified: Number(mtime) * 1000 }
    } catch { return null }
  }

  createReadStream(path) {
    const { PassThrough } = streamMod
    const out = new PassThrough()
    this.client.exec(`cat ${q(path)}`, (err, stream) => { if (err) return out.destroy(err); stream.pipe(out) })
    return out
  }

  upload(path, readable) {
    return new Promise((resolve, reject) => {
      this.client.exec(`cat > ${q(path)}`, (err, stream) => {
        if (err) return reject(err)
        stream.on('close', (code) => code === 0 ? resolve() : reject(new Error(`upload failed (exit ${code})`)))
        readable.on('error', reject)
        readable.pipe(stream)
      })
    })
  }

  read(path) { return this._exec(`cat ${q(path)}`) }
  write(path, buf) { return this._exec(`cat > ${q(path)}`, buf) }
  mkdir(path) { return this._exec(`mkdir -p ${q(path)}`) }
  delete(path, isDir) { return this._exec(isDir ? `rm -rf -- ${q(path)}` : `rm -f -- ${q(path)}`) }
  rename(from, to) { return this._exec(`mv -- ${q(from)} ${q(to)}`) }
  chmod(path, mode) { return this._exec(`chmod ${mode.toString(8)} ${q(path)}`) }
}
