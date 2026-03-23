import { getDb } from '../db/database.js'
import { encrypt, decryptConnection } from '../services/crypto.js'
import { createAdapter } from '../services/filesystem.js'
import { auditLog } from '../middleware/auth.js'

// Allowed connection types (must match schema CHECK constraint)
const ALLOWED_TYPES = ['sftp', 'ftp', 'ftps', 's3']

// Host validation: no spaces, no shell metacharacters
const HOST_RE = /^[a-zA-Z0-9.\-_:]+$/

function validateConnectionInput(body, reply) {
  const { type, host, port } = body || {}

  if (type && !ALLOWED_TYPES.includes(type)) {
    reply.code(400).send({ error: `Tipo inválido. Permitidos: ${ALLOWED_TYPES.join(', ')}` })
    return false
  }

  if (host !== undefined && host !== null && host !== '') {
    if (!HOST_RE.test(host) || host.length > 253) {
      reply.code(400).send({ error: 'Formato de host inválido' })
      return false
    }
  }

  if (port !== undefined && port !== null && port !== '') {
    const p = Number(port)
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      reply.code(400).send({ error: 'Puerto debe ser un número entre 1 y 65535' })
      return false
    }
  }

  return true
}

export default async function connectionsRoutes(fastify) {
  // GET /api/connections — listar conexiones del usuario (sin credenciales)
  fastify.get('/', async (request) => {
    const db = getDb()
    const rows = db.prepare(
      'SELECT id, name, type, host, port, username, root_path, bucket, region, endpoint, color, sort_order, last_connected, created_at FROM connections WHERE user_id = ? ORDER BY sort_order, name'
    ).all(request.user.id)
    return rows
  })

  // POST /api/connections — crear conexión
  fastify.post('/', async (request, reply) => {
    const { name, type, host, port, username, password, private_key, passphrase,
            root_path, bucket, region, endpoint, access_key, secret_key, color } = request.body || {}

    if (!name || !type) {
      return reply.code(400).send({ error: 'Nombre y tipo son requeridos' })
    }

    if (!validateConnectionInput(request.body, reply)) return

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO connections (user_id, name, type, host, port, username, password, private_key, passphrase,
        root_path, bucket, region, endpoint, access_key, secret_key, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.user.id, name, type, host || null, port || null, username || null,
      encrypt(password), encrypt(private_key), encrypt(passphrase),
      root_path || '/', bucket || null, region || 'us-east-1', endpoint || null,
      encrypt(access_key), encrypt(secret_key), color || '#6366f1'
    )

    auditLog(request.user.id, 'connection_create', {
      connectionId: result.lastInsertRowid,
      path: `${type}://${host || 'n/a'}`,
      ip: request.clientIp,
    })

    return { id: result.lastInsertRowid, name, type }
  })

  // GET /api/connections/:id — obtener una (sin credenciales)
  fastify.get('/:id', async (request, reply) => {
    const db = getDb()
    const conn = db.prepare(
      'SELECT id, name, type, host, port, username, root_path, bucket, region, endpoint, color, sort_order, last_connected, created_at FROM connections WHERE id = ? AND user_id = ?'
    ).get(request.params.id, request.user.id)

    if (!conn) return reply.code(404).send({ error: 'Conexión no encontrada' })
    return conn
  })

  // PUT /api/connections/:id — actualizar
  fastify.put('/:id', async (request, reply) => {
    const db = getDb()
    const existing = db.prepare('SELECT id FROM connections WHERE id = ? AND user_id = ?')
      .get(request.params.id, request.user.id)
    if (!existing) return reply.code(404).send({ error: 'Conexión no encontrada' })

    if (!validateConnectionInput(request.body, reply)) return

    const { name, type, host, port, username, password, private_key, passphrase,
            root_path, bucket, region, endpoint, access_key, secret_key, color } = request.body || {}

    // Solo encriptar campos que se envían (si vienen vacíos, mantener los existentes)
    const updates = []
    const values = []

    if (name !== undefined)        { updates.push('name = ?'); values.push(name) }
    if (type !== undefined)        { updates.push('type = ?'); values.push(type) }
    if (host !== undefined)        { updates.push('host = ?'); values.push(host) }
    if (port !== undefined)        { updates.push('port = ?'); values.push(port) }
    if (username !== undefined)    { updates.push('username = ?'); values.push(username) }
    if (password !== undefined)    { updates.push('password = ?'); values.push(encrypt(password)) }
    if (private_key !== undefined) { updates.push('private_key = ?'); values.push(encrypt(private_key)) }
    if (passphrase !== undefined)  { updates.push('passphrase = ?'); values.push(encrypt(passphrase)) }
    if (root_path !== undefined)   { updates.push('root_path = ?'); values.push(root_path) }
    if (bucket !== undefined)      { updates.push('bucket = ?'); values.push(bucket) }
    if (region !== undefined)      { updates.push('region = ?'); values.push(region) }
    if (endpoint !== undefined)    { updates.push('endpoint = ?'); values.push(endpoint) }
    if (access_key !== undefined)  { updates.push('access_key = ?'); values.push(encrypt(access_key)) }
    if (secret_key !== undefined)  { updates.push('secret_key = ?'); values.push(encrypt(secret_key)) }
    if (color !== undefined)       { updates.push('color = ?'); values.push(color) }

    updates.push("updated_at = datetime('now')")
    values.push(request.params.id, request.user.id)

    db.prepare(`UPDATE connections SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...values)

    auditLog(request.user.id, 'connection_update', {
      connectionId: Number(request.params.id),
      ip: request.clientIp,
    })

    return { ok: true }
  })

  // DELETE /api/connections/:id
  fastify.delete('/:id', async (request, reply) => {
    const db = getDb()
    const result = db.prepare('DELETE FROM connections WHERE id = ? AND user_id = ?')
      .run(request.params.id, request.user.id)
    if (result.changes === 0) return reply.code(404).send({ error: 'Conexión no encontrada' })

    auditLog(request.user.id, 'connection_delete', {
      connectionId: Number(request.params.id),
      ip: request.clientIp,
    })

    return { ok: true }
  })

  // POST /api/connections/:id/test — probar conexión
  fastify.post('/:id/test', async (request, reply) => {
    const db = getDb()
    const connRow = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
      .get(request.params.id, request.user.id)
    if (!connRow) return reply.code(404).send({ error: 'Conexión no encontrada' })

    const conn = decryptConnection(connRow)
    const adapter = createAdapter(conn)

    try {
      await adapter.connect()
      const items = await adapter.list(conn.root_path || '/')
      await adapter.disconnect()
      // Actualizar last_connected
      db.prepare("UPDATE connections SET last_connected = datetime('now') WHERE id = ?").run(connRow.id)
      return { ok: true, message: `Conectado. ${items.length} items en ${conn.root_path || '/'}` }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // PUT /api/connections/reorder
  fastify.put('/reorder', async (request) => {
    const { ids } = request.body || {}
    if (!Array.isArray(ids)) return { ok: false }
    const db = getDb()
    const stmt = db.prepare('UPDATE connections SET sort_order = ? WHERE id = ? AND user_id = ?')
    const tx = db.transaction(() => {
      ids.forEach((id, index) => stmt.run(index, id, request.user.id))
    })
    tx()
    return { ok: true }
  })
}
