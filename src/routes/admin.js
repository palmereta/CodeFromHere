// User administration and audit access (admin role only).
import bcrypt from 'bcryptjs'
import { getDb } from '../db/database.js'
import { requireRole, ROLES } from '../security/auth.js'
import { auditLog, verifyAuditChain } from '../security/audit.js'
import { revokeUserSessions } from '../security/sessionStore.js'
import { generateUserKeyPair } from '../services/sshKeygen.js'
import { encrypt } from '../security/crypto.js'
import { validatePassword } from './auth.js'

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('admin'))

  fastify.get('/users', async () => getDb().prepare(
    'SELECT id, username, email, role, mfa_enabled, disabled, last_login_at, created_at FROM users ORDER BY id').all())

  fastify.post('/users', async (request, reply) => {
    const { username, email, password, role = 'user' } = request.body || {}
    if (!USERNAME_RE.test(username || '')) return reply.code(400).send({ error: 'Invalid username' })
    if (!EMAIL_RE.test(email || '')) return reply.code(400).send({ error: 'Invalid email' })
    if (!ROLES.includes(role)) return reply.code(400).send({ error: 'Invalid role' })
    const pwErr = validatePassword(password)
    if (pwErr) return reply.code(400).send({ error: pwErr })
    const db = getDb()
    if (db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(username, email)) {
      return reply.code(409).send({ error: 'User or email already exists' })
    }
    const id = db.prepare("INSERT INTO users (username, email, password, role, password_changed_at) VALUES (?,?,?,?,datetime('now'))")
      .run(username, email, bcrypt.hashSync(password, 12), role).lastInsertRowid
    const { publicKey, privateKey } = generateUserKeyPair(`${username}@codefromhere`)
    db.prepare('INSERT INTO ssh_keys (user_id, name, private_key, public_key) VALUES (?,?,?,?)').run(id, 'default', encrypt(privateKey), publicKey)
    auditLog(request.user.id, 'user_created', { ip: request.ip, target: id, role })
    return { id }
  })

  fastify.put('/users/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const { role, disabled, password, unlock } = request.body || {}
    const db = getDb()
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    if (!target) return reply.code(404).send({ error: 'Not found' })
    if (id === request.user.id && (disabled || (role && role !== 'admin'))) {
      return reply.code(400).send({ error: 'You cannot demote or disable yourself' })
    }
    if (role !== undefined) {
      if (!ROLES.includes(role)) return reply.code(400).send({ error: 'Invalid role' })
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
    }
    if (disabled !== undefined) {
      db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id)
      if (disabled) revokeUserSessions(id)
    }
    if (password !== undefined) {
      const pwErr = validatePassword(password)
      if (pwErr) return reply.code(400).send({ error: pwErr })
      db.prepare("UPDATE users SET password = ?, password_changed_at = datetime('now') WHERE id = ?").run(bcrypt.hashSync(password, 12), id)
      revokeUserSessions(id)
    }
    if (unlock) db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(id)
    auditLog(request.user.id, 'user_updated', { ip: request.ip, target: id, role, disabled, passwordReset: password !== undefined, unlock: !!unlock })
    return { ok: true }
  })

  fastify.delete('/users/:id/sessions', async (request) => {
    revokeUserSessions(Number(request.params.id))
    auditLog(request.user.id, 'user_sessions_revoked', { ip: request.ip, target: Number(request.params.id) })
    return { ok: true }
  })

  fastify.get('/audit', async (request) => {
    const limit = Math.min(Number(request.query.limit) || 200, 5000)
    const before = Number(request.query.before) || Number.MAX_SAFE_INTEGER
    return getDb().prepare(`SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                            WHERE a.id < ? ORDER BY a.id DESC LIMIT ?`).all(before, limit)
  })

  fastify.get('/audit/verify', async () => verifyAuditChain())

  // JSON Lines export for a SIEM / evidence collection.
  fastify.get('/audit/export', async (request, reply) => {
    auditLog(request.user.id, 'audit_exported', { ip: request.ip })
    const rows = getDb().prepare('SELECT * FROM audit_log ORDER BY id').all()
    reply.header('Content-Type', 'application/x-ndjson')
    reply.header('Content-Disposition', `attachment; filename="codefromhere-audit-${new Date().toISOString().slice(0, 10)}.jsonl"`)
    return rows.map(r => JSON.stringify(r)).join('\n') + '\n'
  })
}
