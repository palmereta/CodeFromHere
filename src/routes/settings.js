import { getDb } from '../db/database.js'
import { encrypt, decrypt } from '../services/crypto.js'
import { generateUserKeyPair } from '../services/sshKeygen.js'

export default async function settingsRoutes(fastify) {
  // GET /api/settings/profile
  fastify.get('/profile', async (request) => {
    return {
      id: request.user.id,
      username: request.user.username,
      email: request.user.email,
    }
  })

  // GET /api/settings/ssh-keys — listar claves SSH
  fastify.get('/ssh-keys', async (request) => {
    const db = getDb()
    const keys = db.prepare(
      'SELECT id, name, public_key, created_at FROM ssh_keys WHERE user_id = ?'
    ).all(request.user.id)
    return keys
  })

  // POST /api/settings/ssh-keys — agregar clave SSH
  fastify.post('/ssh-keys', async (request, reply) => {
    const { name, private_key, public_key } = request.body || {}
    if (!name || !private_key) {
      return reply.code(400).send({ error: 'Nombre y clave privada requeridos' })
    }

    const db = getDb()
    const result = db.prepare(
      'INSERT INTO ssh_keys (user_id, name, private_key, public_key) VALUES (?, ?, ?, ?)'
    ).run(request.user.id, name, encrypt(private_key), public_key || null)

    return { id: result.lastInsertRowid, name }
  })

  // DELETE /api/settings/ssh-keys/:id — no permitir borrar la clave default
  fastify.delete('/ssh-keys/:id', async (request, reply) => {
    const db = getDb()
    const key = db.prepare('SELECT id, name FROM ssh_keys WHERE id = ? AND user_id = ?')
      .get(request.params.id, request.user.id)
    if (!key) return reply.code(404).send({ error: 'Clave no encontrada' })
    if (key.name === 'default') return reply.code(400).send({ error: 'No se puede eliminar la clave default. Usá "Regenerar" en su lugar.' })
    const result = db.prepare('DELETE FROM ssh_keys WHERE id = ? AND user_id = ?')
      .run(request.params.id, request.user.id)
    if (result.changes === 0) return reply.code(404).send({ error: 'Clave no encontrada' })
    return { ok: true }
  })

  // GET /api/settings/public-key — obtener la clave pública default del usuario
  fastify.get('/public-key', async (request) => {
    const db = getDb()
    const key = db.prepare(
      "SELECT public_key FROM ssh_keys WHERE user_id = ? AND name = 'default'"
    ).get(request.user.id)
    if (!key) return { public_key: null }
    return { public_key: key.public_key }
  })

  // POST /api/settings/regenerate-key — regenerar el par de claves SSH default
  fastify.post('/regenerate-key', async (request) => {
    const db = getDb()
    const { publicKey, privateKey } = generateUserKeyPair(`${request.user.username}@codefromhere`)
    const existing = db.prepare(
      "SELECT id FROM ssh_keys WHERE user_id = ? AND name = 'default'"
    ).get(request.user.id)

    if (existing) {
      db.prepare("UPDATE ssh_keys SET private_key = ?, public_key = ?, created_at = datetime('now') WHERE id = ?")
        .run(encrypt(privateKey), publicKey, existing.id)
    } else {
      db.prepare('INSERT INTO ssh_keys (user_id, name, private_key, public_key) VALUES (?,?,?,?)')
        .run(request.user.id, 'default', encrypt(privateKey), publicKey)
    }

    return { ok: true, public_key: publicKey }
  })
}
