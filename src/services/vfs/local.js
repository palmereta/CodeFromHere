// Filesystem of the machine running the server (the user's own machine in
// desktop mode). Only available when config.allowLocalShell is on.
import { promises as fs, createReadStream, createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { homedir } from 'node:os'

export class LocalAdapter {
  constructor() { this.caps = { chmod: process.platform !== 'win32', resume: true, symlinks: true } }
  get alive() { return true }
  async connect() {}
  async disconnect() {}
  async home() { return homedir() }

  async list(path) {
    const entries = await fs.readdir(path, { withFileTypes: true })
    return Promise.all(entries.map(async (e) => {
      const full = join(path, e.name)
      let st = null
      try { st = await fs.stat(full) } catch { try { st = await fs.lstat(full) } catch {} }
      return {
        name: e.name, path: full, isDir: st ? st.isDirectory() : e.isDirectory(), isLink: e.isSymbolicLink(),
        size: st?.size ?? 0, modified: st?.mtimeMs ?? null, mode: st ? st.mode & 0o7777 : null,
      }
    }))
  }

  async stat(path) {
    try { const s = await fs.stat(path); return { isDir: s.isDirectory(), size: s.size, modified: s.mtimeMs, mode: s.mode & 0o7777 } }
    catch (e) { if (e.code === 'ENOENT') return null; throw e }
  }

  createReadStream(path, { start = 0 } = {}) { return createReadStream(path, { start }) }

  async upload(path, readable, { append = false } = {}) {
    await fs.mkdir(dirname(path), { recursive: true })
    await pipeline(readable, createWriteStream(path, { flags: append ? 'a' : 'w' }))
  }

  read(path) { return fs.readFile(path) }
  write(path, buf) { return fs.writeFile(path, buf) }
  mkdir(path) { return fs.mkdir(path, { recursive: true }) }
  delete(path, isDir) { return isDir ? fs.rm(path, { recursive: true, force: false }) : fs.unlink(path) }
  rename(from, to) { return fs.rename(from, to) }
  chmod(path, mode) { return fs.chmod(path, mode) }
  setModified(path, ms) { const t = new Date(ms); return fs.utimes(path, t, t) }
}
