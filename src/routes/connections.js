import { getDb } from '../db/database.js'
import { encrypt, decryptConnection, SECRET_FIELDS } from '../security/crypto.js'
import { createAdapter } from '../services/vfs/index.js'
import { auditLog } from '../security/audit.js'
import { trustHost, errorPayload } from '../services/sshConnect.js'
import { parseCSV, parseSshConfig, parseFileZilla } from '../services/importers.js'

export const TYPES = ['ssh', 'sftp', 'scp', 'ftp', 'ftps', 's3', 'telnet']
const DEFAULT_PORTS = { ssh: 22, sftp: 22, scp: 22, ftp: 21, ftps: 21, telnet: 23 }
const HOST_RE = /^[a-zA-Z0-9.\-_:[\]]+$/
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/

const PLAIN_FIELDS = ['name', 'type', 'group_id', 'host', 'port', 'username', 'ssh_key_id', 'use_agent', 'jump_id',
  'root_path', 'bucket', 'region', 'endpoint', 'ftps_implicit', 'tls_verify', 'use_tmux', 'startup_command',
  'encoding', 'tags', 'notes', 'color', 'sort_order']
const LIST_FIELDS = ['id', ...PLAIN_FIELDS, 'last_connected', 'created_at', 'updated_at']
const BOOL_FIELDS = ['use_agent', 'ftps_implicit', 'tls_verify', 'use_tmux']

function bad(msg) { return Object.assign(new Error(msg), { statusCode: 400 }) }

/** Whitelists, validates and encrypts a connection payload. */
function normalize(body, userId, { partial = false } = {}) {
  const db = getDb()
  const out = {}
  for (const f of PLAIN_FIELDS) if (body[f] !== undefined) out[f] = body[f] === '' ? null : body[f]
  for (const f of SECRET_FIELDS) {
    // Empty string on update means "keep"; explicit null means "clear".
    if (body[f] === undefined || (partial && body[f] === '')) continue
    out[f] = encrypt(body[f])
  }
  for (const f of BOOL_FIELDS) if (out[f] !== undefined && out[f] !== null) out[f] = out[f] ? 1 : 0
  if (!partial && !out.name) throw bad('Name is required')
  if (out.type !== undefined && !TYPES.includes(out.type)) throw bad(`Invalid type. Allowed: ${TYPES.join(', ')}`)
  if (out.host && (!HOST_RE.test(out.host) || out.host.length > 253)) throw bad('Invalid host')
  if (out.port !== undefined && out.port !== null) {
    const p = Number(out.port)
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw bad('Port must be 1-65535')
    out.port = p
  }
  if (out.color && !COLOR_RE.test(out.color)) throw bad('Invalid color')
  if (out.name && String(out.name).length > 200) throw bad('Name too long')
  for (const ref of ['group_id', 'jump_id', 'ssh_key_id']) {
    if (out[ref] === undefined || out[ref] === null) continue
    const table = { group_id: 'connection_groups', jump_id: 'connections', ssh_key_id: 'ssh_keys' }[ref]
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(out[ref], userId)) throw bad(`Invalid ${ref}`)
  }
  return out
}

function publicRow(row) {
  const o = {}
  for (const f of LIST_FIELDS) o[f] = row[f]
  for (const f of SECRET_FIELDS) o[`has_${f}`] = !!row[f]
  return o
}

function insertConnection(userId, data) {
  const keys = Object.keys(data)
  return getDb().prepare(`INSERT INTO connections (user_id, ${keys.join(', ')}) VALUES (@user_id, ${keys.map(k => '@' + k).join(', ')})`)
    .run({ user_id: userId, ...data }).lastInsertRowid
}

function ensureGroupPath(userId, path) {
  if (!path) return null
  const db = getDb()
  let parent = null
  for (const name of path.split('/').map(s => s.trim()).filter(Boolean)) {
    const row = db.prepare('SELECT id FROM connection_groups WHERE user_id = ? AND name = ? AND parent_id IS ?').get(userId, name, parent)
    parent = row ? row.id : db.prepare('INSERT INTO connection_groups (user_id, parent_id, name) VALUES (?,?,?)').run(userId, parent, name).lastInsertRowid
  }
  return parent
}

export default async function connectionsRoutes(fastify) {
  const uid = (r) => r.user.id

  // --- Groups ---------------------------------------------------------------
  fastify.get('/groups', async (request) => getDb().prepare('SELECT * FROM connection_groups WHERE user_id = ? ORDER BY sort_order, name').all(uid(request)))

  fastify.post('/groups', async (request, reply) => {
    const { name, parent_id = null, color = null } = request.body || {}
    if (!name || String(name).length > 120) return reply.code(400).send({ error: 'Invalid name' })
    if (parent_id && !getDb().prepare('SELECT 1 FROM connection_groups WHERE id = ? AND user_id = ?').get(parent_id, uid(request))) {
      return reply.code(400).send({ error: 'Invalid parent' })
    }
    const id = getDb().prepare('INSERT INTO connection_groups (user_id, parent_id, name, color) VALUES (?,?,?,?)').run(uid(request), parent_id, name, color).lastInsertRowid
    return { id }
  })

  fastify.put('/groups/:id', async (request, reply) => {
    const db = getDb()
    const id = Number(request.params.id)
    const g = db.prepare('SELECT * FROM connection_groups WHERE id = ? AND user_id = ?').get(id, uid(request))
    if (!g) return reply.code(404).send({ error: 'Not found' })
    const { name, parent_id, color, collapsed, sort_order } = request.body || {}
    if (parent_id !== undefined && parent_id !== null) {
      // Prevent cycles: the new parent cannot be the group itself or a descendant.
      let p = parent_id
      while (p) {
        if (p === id) return reply.code(400).send({ error: 'A group cannot be inside itself' })
        p = db.prepare('SELECT parent_id FROM connection_groups WHERE id = ? AND user_id = ?').get(p, uid(request))?.parent_id
      }
    }
    db.prepare(`UPDATE connection_groups SET name = COALESCE(?, name), parent_id = ?, color = COALESCE(?, color),
                collapsed = COALESCE(?, collapsed), sort_order = COALESCE(?, sort_order) WHERE id = ?`)
      .run(name ?? null, parent_id === undefined ? g.parent_id : parent_id, color ?? null,
        collapsed === undefined ? null : (collapsed ? 1 : 0), sort_order ?? null, id)
    return { ok: true }
  })

  fastify.delete('/groups/:id', async (request, reply) => {
    const r = getDb().prepare('DELETE FROM connection_groups WHERE id = ? AND user_id = ?').run(Number(request.params.id), uid(request))
    if (!r.changes) return reply.code(404).send({ error: 'Not found' })
    return { ok: true }
  })

  // --- Known hosts ----------------------------------------------------------
  fastify.get('/known-hosts', async (request) => getDb().prepare('SELECT * FROM known_hosts WHERE user_id = ? ORDER BY host').all(uid(request)))

  fastify.delete('/known-hosts/:id', async (request) => {
    getDb().prepare('DELETE FROM known_hosts WHERE id = ? AND user_id = ?').run(Number(request.params.id), uid(request))
    auditLog(uid(request), 'known_host_removed', { ip: request.ip, id: Number(request.params.id) })
    return { ok: true }
  })

  // --- Connections ----------------------------------------------------------
  fastify.get('/', async (request) => getDb()
    .prepare('SELECT * FROM connections WHERE user_id = ? ORDER BY sort_order, name').all(uid(request)).map(publicRow))

  fastify.get('/:id', async (request, reply) => {
    const row = getDb().prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').get(Number(request.params.id), uid(request))
    return row ? publicRow(row) : reply.code(404).send({ error: 'Not found' })
  })

  fastify.post('/', async (request, reply) => {
    let data
    try { data = normalize(request.body || {}, uid(request)) } catch (e) { return reply.code(e.statusCode || 400).send({ error: e.message }) }
    if (!data.type) return reply.code(400).send({ error: 'Type is required' })
    data.port ??= DEFAULT_PORTS[data.type] ?? null
    const id = insertConnection(uid(request), data)
    auditLog(uid(request), 'connection_create', { connectionId: id, ip: request.ip, path: `${data.type}://${data.host || data.bucket || ''}` })
    return { id }
  })

  fastify.put('/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM connections WHERE id = ? AND user_id = ?').get(id, uid(request))) return reply.code(404).send({ error: 'Not found' })
    let data
    try { data = normalize(request.body || {}, uid(request), { partial: true }) } catch (e) { return reply.code(e.statusCode || 400).send({ error: e.message }) }
    if (data.jump_id === id) return reply.code(400).send({ error: 'A site cannot jump through itself' })
    if (Object.keys(data).length) {
      db.prepare(`UPDATE connections SET ${Object.keys(data).map(k => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...data, id })
    }
    auditLog(uid(request), 'connection_update', { connectionId: id, ip: request.ip, fields: Object.keys(data) })
    return { ok: true }
  })

  fastify.post('/:id/duplicate', async (request, reply) => {
    const row = getDb().prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').get(Number(request.params.id), uid(request))
    if (!row) return reply.code(404).send({ error: 'Not found' })
    const copy = {}
    for (const f of [...PLAIN_FIELDS, ...SECRET_FIELDS]) copy[f] = row[f]
    copy.name = `${row.name} (copy)`
    return { id: insertConnection(uid(request), copy) }
  })

  fastify.delete('/:id', async (request, reply) => {
    const r = getDb().prepare('DELETE FROM connections WHERE id = ? AND user_id = ?').run(Number(request.params.id), uid(request))
    if (!r.changes) return reply.code(404).send({ error: 'Not found' })
    auditLog(uid(request), 'connection_delete', { connectionId: Number(request.params.id), ip: request.ip })
    return { ok: true }
  })

  fastify.post('/:id/test', async (request, reply) => {
    const row = getDb().prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').get(Number(request.params.id), uid(request))
    if (!row) return reply.code(404).send({ error: 'Not found' })
    if (row.type === 'telnet') return { ok: true, message: 'Telnet sites are tested when opening a terminal' }
    const adapter = createAdapter(decryptConnection(row), uid(request))
    try {
      await adapter.connect()
      const items = await adapter.list(row.root_path || '/')
      return { ok: true, message: `Connected. ${items.length} items in ${row.root_path || '/'}` }
    } catch (err) {
      return { ok: false, ...errorPayload(err) }
    } finally {
      await adapter.disconnect().catch(() => {})
    }
  })

  // The UI calls this after the user confirmed a fingerprint.
  fastify.post('/:id/trust-host', async (request, reply) => {
    const row = getDb().prepare('SELECT host, port, type FROM connections WHERE id = ? AND user_id = ?').get(Number(request.params.id), uid(request))
    if (!row) return reply.code(404).send({ error: 'Not found' })
    const { fingerprint, host = row.host, port = row.port || 22, keyType = null } = request.body || {}
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint || '')) return reply.code(400).send({ error: 'Invalid fingerprint' })
    // The host may be a jump host of this connection; only allow hosts the user has configured.
    const owned = getDb().prepare('SELECT 1 FROM connections WHERE user_id = ? AND host = ?').get(uid(request), host)
    if (!owned) return reply.code(400).send({ error: 'Unknown host' })
    trustHost(uid(request), host, Number(port), fingerprint, keyType)
    auditLog(uid(request), 'host_key_trusted', { connectionId: Number(request.params.id), ip: request.ip, host, port, fingerprint })
    return { ok: true }
  })

  // [{ id, group_id, sort_order }] — drag & drop in the sites tree
  fastify.put('/reorder', async (request, reply) => {
    const items = request.body?.items
    if (!Array.isArray(items)) return reply.code(400).send({ error: 'items required' })
    const db = getDb()
    const stmt = db.prepare('UPDATE connections SET sort_order = ?, group_id = ? WHERE id = ? AND user_id = ?')
    const okGroup = (g) => g === null || !!db.prepare('SELECT 1 FROM connection_groups WHERE id = ? AND user_id = ?').get(g, uid(request))
    db.transaction(() => {
      for (const it of items) {
        const g = it.group_id ?? null
        if (okGroup(g)) stmt.run(Number(it.sort_order) || 0, g, Number(it.id), uid(request))
      }
    })()
    return { ok: true }
  })

  // Body: { format: 'csv'|'ssh_config'|'filezilla', content: string }
  fastify.post('/import', { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const { format, content } = request.body || {}
    if (typeof content !== 'string' || !content.trim()) return reply.code(400).send({ error: 'content required' })
    let rows
    try {
      rows = format === 'ssh_config' ? parseSshConfig(content)
        : format === 'filezilla' ? parseFileZilla(content)
        : parseCSV(content)
    } catch (e) { return reply.code(400).send({ error: `Could not parse file: ${e.message}` }) }

    const errors = []
    let imported = 0
    const db = getDb()
    db.transaction(() => {
      rows.forEach((row, i) => {
        try {
          const group_id = ensureGroupPath(uid(request), row.group)
          const { group, ...fields } = row
          const data = normalize({ ...fields, group_id }, uid(request))
          if (!data.type) throw bad('Missing type')
          data.port ??= DEFAULT_PORTS[data.type] ?? null
          insertConnection(uid(request), data)
          imported++
        } catch (e) { errors.push({ row: i + 1, name: row.name, error: e.message }) }
      })
    })()
    auditLog(uid(request), 'connections_import', { ip: request.ip, format, imported, failed: errors.length })
    return { imported, failed: errors.length, errors }
  })
}
