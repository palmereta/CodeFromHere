import { getDb } from '../db/database.js'
import { encrypt, decryptConnection } from '../services/crypto.js'
import { createAdapter } from '../services/filesystem.js'
import { auditLog } from '../middleware/auth.js'

// Allowed connection types (must match schema CHECK constraint)
const ALLOWED_TYPES = ['sftp', 'ftp', 'ftps', 's3']

// Host validation: no spaces, no shell metacharacters
const HOST_RE = /^[a-zA-Z0-9.\-_:]+$/

function parseCSV(text) {
  // Remove BOM if present
  const clean = text.replace(/^\uFEFF/, '').trim()
  const lines = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (ch === '"') {
      if (inQuotes && clean[i + 1] === '"') { current += '"'; i++; continue }
      inQuotes = !inQuotes; continue
    }
    if ((ch === '\n' || (ch === '\r' && clean[i + 1] === '\n')) && !inQuotes) {
      lines.push(current); current = ''
      if (ch === '\r') i++ // skip \n after \r
      continue
    }
    current += ch
  }
  if (current.trim()) lines.push(current)

  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = []
    let val = '', inQ = false
    for (let j = 0; j < lines[i].length; j++) {
      const c = lines[i][j]
      if (c === '"') { if (inQ && lines[i][j+1] === '"') { val += '"'; j++ } else { inQ = !inQ }; continue }
      if (c === ',' && !inQ) { values.push(val.trim()); val = ''; continue }
      val += c
    }
    values.push(val.trim())

    const row = {}
    headers.forEach((h, idx) => { row[h] = values[idx] || '' })
    if (Object.values(row).some(v => v !== '')) rows.push(row)
  }
  return rows
}

function validateCSVRow(row, rowNum) {
  if (!row.name?.trim()) return `Nombre requerido`
  const allowedTypes = ['sftp', 'ftp', 'ftps', 's3']
  if (!allowedTypes.includes(row.type?.toLowerCase())) return `Tipo invalido: ${row.type} (usar: sftp, ftp, ftps, s3)`

  const type = row.type.toLowerCase()
  if (type !== 's3') {
    if (!row.host?.trim()) return `Host requerido para ${type}`
    if (row.port && (isNaN(row.port) || Number(row.port) < 1 || Number(row.port) > 65535)) return `Puerto invalido: ${row.port}`
  }
  if (type === 's3') {
    if (!row.bucket?.trim()) return `Bucket requerido para S3`
  }
  return null // valid
}

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

  // POST /api/connections/import — bulk import from CSV
  fastify.post('/import', async (request, reply) => {
    const parts = request.parts()
    let csvText = null

    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks = []
        for await (const chunk of part.file) chunks.push(chunk)
        csvText = Buffer.concat(chunks).toString('utf8')
      }
    }

    if (!csvText) {
      return reply.code(400).send({ error: 'Archivo CSV requerido' })
    }

    const rows = parseCSV(csvText)
    if (rows.length === 0) {
      return reply.code(400).send({ error: 'CSV vacío o sin filas de datos' })
    }

    const errors = []
    const validRows = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const err = validateCSVRow(row, i + 2) // +2 because row 1 is headers, data starts at 2
      if (err) {
        errors.push({ row: i + 2, error: err })
      } else {
        validRows.push(row)
      }
    }

    if (validRows.length === 0) {
      return reply.code(400).send({ error: 'Ninguna fila válida en el CSV', errors })
    }

    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO connections (user_id, name, type, host, port, username, password, private_key, passphrase,
        root_path, bucket, region, endpoint, access_key, secret_key, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let imported = 0
    const tx = db.transaction(() => {
      for (const row of validRows) {
        const type = row.type.toLowerCase()
        const authMethod = (row.auth_method || '').toLowerCase()
        // For publickey auth, store null password (system key will be used automatically)
        const password = authMethod === 'publickey' ? null : (row.password || null)

        stmt.run(
          request.user.id,
          row.name.trim(),
          type,
          row.host?.trim() || null,
          row.port ? Number(row.port) : null,
          row.username?.trim() || null,
          encrypt(password),
          encrypt(row.private_key || null),
          encrypt(row.passphrase || null),
          row.root_path?.trim() || '/',
          row.bucket?.trim() || null,
          row.region?.trim() || 'us-east-1',
          row.endpoint?.trim() || null,
          encrypt(row.access_key || null),
          encrypt(row.secret_key || null),
          row.color?.trim() || '#6366f1'
        )
        imported++
      }
    })
    tx()

    auditLog(request.user.id, 'connections_import', {
      imported,
      failed: errors.length,
      ip: request.clientIp,
    })

    return { imported, failed: errors.length, errors }
  })
}
