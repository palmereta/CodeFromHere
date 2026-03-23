import { getDb } from '../db/database.js'
import { nanoid } from 'nanoid'
import { auditLog } from '../middleware/auth.js'

// Rate limiting simple: Map de userId → timestamps[]
const rateLimits = new Map()
const RATE_LIMIT = 10  // máximo 10 tokens por minuto
const RATE_WINDOW = 60000  // 1 minuto

function checkRateLimit(userId) {
  const now = Date.now()
  const timestamps = rateLimits.get(userId) || []
  const recent = timestamps.filter(t => now - t < RATE_WINDOW)
  if (recent.length >= RATE_LIMIT) {
    return false
  }
  recent.push(now)
  rateLimits.set(userId, recent)
  return true
}

export default async function terminalRoutes(fastify) {
  // POST /api/terminal/token — generar token para WebSocket SSH
  fastify.post('/token', async (request, reply) => {
    const { connection_id, path } = request.body || {}
    if (!connection_id) {
      return reply.code(400).send({ error: 'connection_id requerido' })
    }

    // Rate limiting
    if (!checkRateLimit(request.user.id)) {
      return reply.code(429).send({ error: 'Demasiadas solicitudes. Esperá un momento.' })
    }

    // Verificar que la conexión existe y es del usuario
    const db = getDb()
    const conn = db.prepare('SELECT id, type FROM connections WHERE id = ? AND user_id = ?')
      .get(connection_id, request.user.id)
    if (!conn) {
      return reply.code(404).send({ error: 'Conexión no encontrada' })
    }
    if (conn.type !== 'sftp') {
      return reply.code(400).send({ error: 'Terminal solo disponible para conexiones SFTP/SSH' })
    }

    // Generar token único
    const token = nanoid(32)
    const expiresAt = new Date(Date.now() + 3600000).toISOString() // 1 hora

    db.prepare(`
      INSERT INTO terminal_tokens (token, user_id, connection_id, initial_path, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, request.user.id, connection_id, path || '/', expiresAt)

    // Limpiar tokens expirados
    db.prepare("DELETE FROM terminal_tokens WHERE expires_at < datetime('now')").run()

    auditLog(request.user.id, 'terminal_token_created', {
      connectionId: connection_id,
      path: path || '/',
      ip: request.clientIp,
    })

    return {
      token,
      ws_url: token  // El frontend construye la URL completa
    }
  })
}
