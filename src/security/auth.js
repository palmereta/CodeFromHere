// Authentication, session lifetime and role checks (SOC2 CC6.1–CC6.3,
// OWASP ASVS V2/V3/V4).
import { getDb } from '../db/database.js'
import { config } from '../config.js'

export const ROLES = ['admin', 'user']

const PUBLIC = new Set(['/api/auth/login', '/api/auth/desktop', '/api/auth/status'])

export function registerAuth(fastify) {
  fastify.decorateRequest('user', null)

  fastify.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]
    if (!path.startsWith('/api/') && !path.startsWith('/ws/')) return
    if (PUBLIC.has(path)) return

    const s = request.session
    if (!s?.userId) return reply.code(401).send({ error: 'Not authenticated' })

    const now = Date.now()
    const idleMs = config.sessionIdleMinutes * 60_000
    const absMs = config.sessionAbsoluteHours * 3_600_000
    if ((s.lastSeen && now - s.lastSeen > idleMs) || (s.createdAt && now - s.createdAt > absMs)) {
      await s.destroy()
      return reply.code(401).send({ error: 'Session expired' })
    }
    // Sliding idle window; persisting at most once a minute keeps writes low.
    if (!s.lastSeen || now - s.lastSeen > 60_000) s.lastSeen = now

    const user = getDb().prepare('SELECT id, username, email, role, mfa_enabled, disabled FROM users WHERE id = ?').get(s.userId)
    if (!user || user.disabled) {
      await s.destroy()
      return reply.code(401).send({ error: 'Not authenticated' })
    }
    request.user = user
  })
}

/** preHandler guard: `{ preHandler: requireRole('admin') }` */
export function requireRole(...roles) {
  return async (request, reply) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Forbidden' })
    }
  }
}

export async function startSession(request, user) {
  // Session fixation protection: new id after authentication.
  await request.session.regenerate()
  request.session.userId = user.id
  request.session.createdAt = Date.now()
  request.session.lastSeen = Date.now()
  request.session.ip = request.ip
  request.session.userAgent = String(request.headers['user-agent'] || '').slice(0, 200)
}
