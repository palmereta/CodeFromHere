import { getDb } from '../db/database.js'

// --- Login rate limiting: max 5 failed attempts per IP per 15 min ---
const loginAttempts = new Map() // ip -> { count, firstAttempt }
const LOGIN_MAX_ATTEMPTS = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

export function checkLoginRateLimit(ip) {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry) return true
  if (now - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip)
    return true
  }
  return entry.count < LOGIN_MAX_ATTEMPTS
}

export function recordLoginFailure(ip) {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry || now - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now })
  } else {
    entry.count++
  }
}

export function resetLoginAttempts(ip) {
  loginAttempts.delete(ip)
}

// --- Session fixation protection ---
export async function regenerateSession(request) {
  // Save current session data, destroy, then recreate with new ID
  const userId = request.session.userId
  return new Promise((resolve, reject) => {
    request.session.regenerate((err) => {
      if (err) {
        // Fallback: just set the value if regenerate fails
        request.session.userId = userId
        resolve()
        return
      }
      request.session.userId = userId
      resolve()
    })
  })
}

// --- Audit logging helper ---
export function auditLog(userId, action, opts = {}) {
  try {
    const db = getDb()
    db.prepare(
      'INSERT INTO audit_log (user_id, connection_id, action, path, ip) VALUES (?, ?, ?, ?, ?)'
    ).run(
      userId || 0,
      opts.connectionId || null,
      action,
      opts.path || null,
      opts.ip || null
    )
  } catch {
    // Never let audit logging break the request
  }
}

export function authMiddleware(fastify) {
  fastify.addHook('onRequest', async (request, reply) => {
    // Attach client IP to every request for audit logging
    request.clientIp = request.ip || request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'

    // Rutas públicas que no requieren auth
    const publicPaths = ['/api/auth/login', '/api/auth/register']
    if (publicPaths.includes(request.url)) return

    // Solo proteger rutas /api/ y /ws/
    if (!request.url.startsWith('/api/') && !request.url.startsWith('/ws/')) return

    // WebSocket terminal usa token, no sesión
    if (request.url.startsWith('/ws/terminal')) return

    if (!request.session?.userId) {
      reply.code(401).send({ error: 'No autenticado' })
      return
    }

    const db = getDb()
    const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?')
      .get(request.session.userId)

    if (!user) {
      request.session.destroy()
      reply.code(401).send({ error: 'Usuario no encontrado' })
      return
    }

    request.user = user
  })
}
