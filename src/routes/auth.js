import bcrypt from 'bcryptjs'
import * as OTPAuth from 'otpauth'
import { getDb } from '../db/database.js'
import { config } from '../config.js'
import { auditLog } from '../security/audit.js'
import { startSession } from '../security/auth.js'
import { encrypt, decrypt, sha256, safeEqual } from '../security/crypto.js'
import { revokeUserSessions } from '../security/sessionStore.js'

// bcrypt of a random string: comparing against it keeps timing constant when
// the username does not exist (prevents user enumeration).
const DUMMY_HASH = bcrypt.hashSync('codefromhere-dummy-' + Math.random(), 12)
let desktopTokenUsed = false

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < config.passwordMinLength) return `Password must have at least ${config.passwordMinLength} characters`
  if (pw.length > 256) return 'Password too long'
  if (/^(.)\1+$/.test(pw)) return 'Password is too simple'
  return null
}

function totpFor(user, secret) {
  return new OTPAuth.TOTP({ issuer: 'CodeFromHere', label: user.username, algorithm: 'SHA1', digits: 6, period: 30, secret })
}

const verifyTotp = (user, secretB32, code) =>
  totpFor(user, OTPAuth.Secret.fromBase32(secretB32)).validate({ token: String(code || '').replace(/\s/g, ''), window: 1 }) !== null

const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, role: u.role, mfa_enabled: !!u.mfa_enabled })

export default async function authRoutes(fastify) {
  fastify.get('/status', async (request) => ({
    mode: config.mode,
    authenticated: !!request.session?.userId,
  }))

  // Desktop: Electron opens /api/auth/desktop?token=… once at startup.
  fastify.get('/desktop', async (request, reply) => {
    const token = request.query?.token
    if (config.mode !== 'desktop' || !config.desktopToken || desktopTokenUsed || !token || !safeEqual(token, config.desktopToken)) {
      return reply.code(403).send({ error: 'Forbidden' })
    }
    desktopTokenUsed = true
    const user = getDb().prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get()
    await startSession(request, user)
    auditLog(user.id, 'login_desktop', { ip: request.ip })
    return reply.redirect('/')
  })

  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const { username, password, otp } = request.body || {}
    if (typeof username !== 'string' || typeof password !== 'string') {
      return reply.code(400).send({ error: 'Username and password required' })
    }
    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
    const valid = bcrypt.compareSync(password, user?.password || DUMMY_HASH)

    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      auditLog(user.id, 'login_locked', { ip: request.ip })
      return reply.code(423).send({ error: 'Account temporarily locked. Try again later.' })
    }
    if (!user || !valid || user.disabled) {
      if (user) {
        const fails = user.failed_logins + 1
        const lock = fails >= config.lockoutThreshold ? new Date(Date.now() + config.lockoutMinutes * 60_000).toISOString() : null
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, user.id)
        if (lock) auditLog(user.id, 'account_locked', { ip: request.ip })
      }
      auditLog(user?.id || 0, 'login_failed', { ip: request.ip, path: username.slice(0, 64) })
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    if (user.mfa_enabled) {
      if (!otp) return reply.code(401).send({ error: 'MFA code required', mfa_required: true })
      if (!verifyTotp(user, decrypt(user.mfa_secret), otp)) {
        auditLog(user.id, 'login_mfa_failed', { ip: request.ip })
        return reply.code(401).send({ error: 'Invalid MFA code', mfa_required: true })
      }
    }
    db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?").run(user.id)
    await startSession(request, user)
    auditLog(user.id, 'login_success', { ip: request.ip })
    return publicUser(user)
  })

  fastify.post('/logout', async (request) => {
    auditLog(request.user.id, 'logout', { ip: request.ip })
    await request.session.destroy()
    return { ok: true }
  })

  fastify.get('/me', async (request) => publicUser(request.user))

  fastify.put('/password', async (request, reply) => {
    const { current_password, new_password } = request.body || {}
    const err = validatePassword(new_password)
    if (err) return reply.code(400).send({ error: err })
    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id)
    if (!bcrypt.compareSync(String(current_password || ''), user.password)) {
      auditLog(user.id, 'password_change_failed', { ip: request.ip })
      return reply.code(401).send({ error: 'Current password is incorrect' })
    }
    db.prepare("UPDATE users SET password = ?, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(bcrypt.hashSync(new_password, 12), user.id)
    revokeUserSessions(user.id, request.session.sessionId)
    auditLog(user.id, 'password_changed', { ip: request.ip })
    return { ok: true }
  })

  // --- MFA (TOTP) -----------------------------------------------------------
  fastify.post('/mfa/setup', async (request) => {
    const secret = new OTPAuth.Secret({ size: 20 })
    getDb().prepare('UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?').run(encrypt(secret.base32), request.user.id)
    return { secret: secret.base32, uri: totpFor(request.user, secret).toString() }
  })

  fastify.post('/mfa/enable', async (request, reply) => {
    const row = getDb().prepare('SELECT mfa_secret FROM users WHERE id = ?').get(request.user.id)
    if (!row?.mfa_secret || !verifyTotp(request.user, decrypt(row.mfa_secret), request.body?.otp)) {
      return reply.code(400).send({ error: 'Invalid code' })
    }
    getDb().prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').run(request.user.id)
    auditLog(request.user.id, 'mfa_enabled', { ip: request.ip })
    return { ok: true }
  })

  fastify.post('/mfa/disable', async (request, reply) => {
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(request.user.id)
    if (!bcrypt.compareSync(String(request.body?.password || ''), user.password)) {
      return reply.code(401).send({ error: 'Password is incorrect' })
    }
    getDb().prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(user.id)
    auditLog(user.id, 'mfa_disabled', { ip: request.ip })
    return { ok: true }
  })

  // --- Own sessions (list / revoke) -----------------------------------------
  fastify.get('/sessions', async (request) => {
    const rows = getDb().prepare('SELECT sid, created_at, expires_at, ip, user_agent FROM http_sessions WHERE user_id = ? ORDER BY created_at DESC').all(request.user.id)
    return rows.map(r => ({
      id: sha256(r.sid).slice(0, 16), current: r.sid === request.session.sessionId,
      created_at: r.created_at, expires_at: r.expires_at, ip: r.ip, user_agent: r.user_agent,
    }))
  })

  fastify.delete('/sessions/:id', async (request, reply) => {
    const rows = getDb().prepare('SELECT sid FROM http_sessions WHERE user_id = ?').all(request.user.id)
    const row = rows.find(r => sha256(r.sid).slice(0, 16) === request.params.id)
    if (!row) return reply.code(404).send({ error: 'Not found' })
    getDb().prepare('DELETE FROM http_sessions WHERE sid = ?').run(row.sid)
    auditLog(request.user.id, 'session_revoked', { ip: request.ip })
    return { ok: true }
  })
}
