// File explorer API over the VFS. `source` = connection id or "local".
import { pooledSource, evictSource } from '../services/vfs/index.js'
import { errorPayload } from '../services/sshConnect.js'
import { auditLog } from '../security/audit.js'
import { config } from '../config.js'

const MAX_EDITOR_BYTES = 10 * 1024 * 1024

function cleanPath(p) {
  if (typeof p !== 'string' || !p) throw Object.assign(new Error('path required'), { statusCode: 400 })
  if (p.includes('\0')) throw Object.assign(new Error('Invalid path'), { statusCode: 400 })
  if (p.length > 4096) throw Object.assign(new Error('Path too long'), { statusCode: 400 })
  return p
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0)
const src = (q) => (q.source === 'local' ? 'local' : Number(q.source))

export default async function filesRoutes(fastify) {
  // Uniform error handling: connection problems → 502 with host-key info.
  async function withSource(request, reply, fn) {
    const q = { ...request.query, ...(request.body || {}) }
    const source = src(q)
    if (source !== 'local' && !Number.isInteger(source)) return reply.code(400).send({ error: 'source required' })
    try {
      const adapter = await pooledSource(request.user.id, source, request.user)
      return await fn(adapter, q, source)
    } catch (err) {
      if (!err.statusCode) await evictSource(request.user.id, source)
      return reply.code(err.statusCode || (err.code === 2 || err.code === 'ENOENT' ? 404 : 502)).send(errorPayload(err))
    }
  }

  fastify.get('/home', (req, reply) => withSource(req, reply, async (a, q, source) => {
    if (source !== 'local' && a.connection?.root_path && a.connection.root_path !== '/') return { path: a.connection.root_path }
    return { path: await a.home() }
  }))

  fastify.get('/list', (req, reply) => withSource(req, reply, async (a, q) => {
    const items = await a.list(cleanPath(q.path))
    return items.sort((x, y) => (y.isDir - x.isDir) || x.name.localeCompare(y.name, undefined, { numeric: true }))
  }))

  fastify.get('/stat', (req, reply) => withSource(req, reply, async (a, q) => (await a.stat(cleanPath(q.path))) || reply.code(404).send({ error: 'Not found' })))

  fastify.get('/read', (req, reply) => withSource(req, reply, async (a, q, source) => {
    const path = cleanPath(q.path)
    const st = await a.stat(path)
    if (!st) return reply.code(404).send({ error: 'Not found' })
    if (st.size > MAX_EDITOR_BYTES) return reply.code(413).send({ error: 'File too large for the editor; download it instead' })
    const buf = await a.read(path)
    auditLog(req.user.id, 'file_read', { connectionId: source === 'local' ? null : source, path })
    if (isBinary(buf)) return { binary: true, size: buf.length, modified: st.modified }
    return { content: buf.toString('utf8'), size: buf.length, modified: st.modified }
  }))

  fastify.post('/write', (req, reply) => withSource(req, reply, async (a, q, source) => {
    const path = cleanPath(q.path)
    if (typeof q.content !== 'string') return reply.code(400).send({ error: 'content required' })
    // Optimistic concurrency: refuse to overwrite a file changed since it was opened.
    if (q.expectedModified && !q.force) {
      const st = await a.stat(path)
      if (st?.modified && Math.abs(st.modified - q.expectedModified) > 1000) {
        return reply.code(409).send({ error: 'The file changed on the server since you opened it', code: 'CONFLICT', modified: st.modified })
      }
    }
    await a.write(path, Buffer.from(q.content, 'utf8'))
    auditLog(req.user.id, 'file_write', { connectionId: source === 'local' ? null : source, path, size: q.content.length })
    return { ok: true, modified: (await a.stat(path))?.modified ?? Date.now() }
  }))

  fastify.post('/mkdir', (req, reply) => withSource(req, reply, async (a, q, source) => {
    await a.mkdir(cleanPath(q.path))
    auditLog(req.user.id, 'file_mkdir', { connectionId: source === 'local' ? null : source, path: q.path })
    return { ok: true }
  }))

  fastify.post('/touch', (req, reply) => withSource(req, reply, async (a, q, source) => {
    const path = cleanPath(q.path)
    if (await a.stat(path)) return reply.code(409).send({ error: 'Already exists' })
    await a.write(path, Buffer.alloc(0))
    auditLog(req.user.id, 'file_create', { connectionId: source === 'local' ? null : source, path })
    return { ok: true }
  }))

  fastify.post('/rename', (req, reply) => withSource(req, reply, async (a, q, source) => {
    await a.rename(cleanPath(q.from), cleanPath(q.to))
    auditLog(req.user.id, 'file_rename', { connectionId: source === 'local' ? null : source, path: q.from, to: q.to })
    return { ok: true }
  }))

  fastify.post('/delete', (req, reply) => withSource(req, reply, async (a, q, source) => {
    const paths = Array.isArray(q.items) ? q.items : [{ path: q.path, isDir: q.isDir }]
    for (const it of paths) {
      const path = cleanPath(it.path)
      if (/^(\/|[A-Za-z]:\\?)$/.test(path)) return reply.code(400).send({ error: 'Refusing to delete a filesystem root' })
      await a.delete(path, !!it.isDir)
      auditLog(req.user.id, 'file_delete', { connectionId: source === 'local' ? null : source, path, isDir: !!it.isDir })
    }
    return { ok: true }
  }))

  fastify.post('/chmod', (req, reply) => withSource(req, reply, async (a, q, source) => {
    if (!a.caps.chmod) return reply.code(400).send({ error: 'Not supported for this source' })
    const mode = typeof q.mode === 'string' ? parseInt(q.mode, 8) : Number(q.mode)
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) return reply.code(400).send({ error: 'Invalid mode' })
    await a.chmod(cleanPath(q.path), mode)
    auditLog(req.user.id, 'file_chmod', { connectionId: source === 'local' ? null : source, path: q.path, mode: mode.toString(8) })
    return { ok: true }
  }))

  fastify.get('/download', (req, reply) => withSource(req, reply, async (a, q, source) => {
    const path = cleanPath(q.path)
    const st = await a.stat(path)
    if (!st || st.isDir) return reply.code(404).send({ error: 'Not found' })
    const name = path.split(/[\\/]/).pop()
    auditLog(req.user.id, 'file_download', { connectionId: source === 'local' ? null : source, path })
    reply.header('Content-Type', 'application/octet-stream')
    reply.header('Content-Length', st.size)
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
    return reply.send(a.createReadStream(path))
  }))

  // multipart: fields `source`, `dir` must come before the files
  fastify.post('/upload', async (request, reply) => {
    let source = null, dir = null, count = 0
    try {
      for await (const part of request.parts({ limits: { fileSize: config.uploadLimitBytes } })) {
        if (part.type === 'field') {
          if (part.fieldname === 'source') source = part.value === 'local' ? 'local' : Number(part.value)
          if (part.fieldname === 'dir') dir = cleanPath(part.value)
          continue
        }
        if (source === null || !dir) return reply.code(400).send({ error: 'source and dir fields must precede files' })
        const a = await pooledSource(request.user.id, source, request.user)
        const rel = (part.filename || 'upload').replace(/\\/g, '/').split('/').filter(s => s && s !== '..' && s !== '.')
        const target = `${dir.replace(/[\\/]+$/, '')}/${rel.join('/')}`
        if (rel.length > 1) await a.mkdir(target.slice(0, target.lastIndexOf('/')))
        await a.upload(target, part.file)
        if (part.file.truncated) return reply.code(413).send({ error: 'File exceeds the upload limit' })
        auditLog(request.user.id, 'file_upload', { connectionId: source === 'local' ? null : source, path: target })
        count++
      }
      return { ok: true, uploaded: count }
    } catch (err) {
      return reply.code(err.statusCode || 502).send(errorPayload(err))
    }
  })
}
