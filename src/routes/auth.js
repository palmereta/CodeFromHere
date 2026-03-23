import bcrypt from 'bcryptjs'
import { getDb } from '../db/database.js'
import {
  checkLoginRateLimit,
  recordLoginFailure,
  resetLoginAttempts,
  regenerateSession,
  auditLog,
} from '../middleware/auth.js'
import { generateUserKeyPair } from '../services/sshKeygen.js'
import { encrypt } from '../services/crypto.js'

// Validation helpers
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN = 8

export default async function authRoutes(fastify) {
  // POST /api/auth/login
  fastify.post('/login', async (request, reply) => {
    const { username, password } = request.body || {}
    if (!username || !password) {
      return reply.code(400).send({ error: 'Username y password requeridos' })
    }

    const ip = request.clientIp || request.ip || 'unknown'

    // Rate limiting check before any DB/bcrypt work
    if (!checkLoginRateLimit(ip)) {
      auditLog(0, 'login_rate_limited', { ip })
      return reply.code(429).send({ error: 'Demasiados intentos. Intentá de nuevo en 15 minutos.' })
    }

    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)

    // Prevent user enumeration: always run bcrypt even if user not found.
    // This ensures constant-time regardless of whether the user exists.
    const dummyHash = '$2a$12$000000000000000000000uGSHMaLPSZaxyJaEyBqjMGzLbKnTypa' // pre-computed dummy
    const hashToCheck = user ? user.password : dummyHash
    const valid = bcrypt.compareSync(password, hashToCheck)

    if (!user || !valid) {
      recordLoginFailure(ip)
      auditLog(user?.id || 0, 'login_failed', { ip, path: username })
      // Same error message regardless of reason — prevents user enumeration
      return reply.code(401).send({ error: 'Credenciales inválidas' })
    }

    // Successful login
    resetLoginAttempts(ip)
    request.session.userId = user.id

    // Session fixation protection: regenerate session ID after login
    await regenerateSession(request)

    auditLog(user.id, 'login_success', { ip })

    return { id: user.id, username: user.username, email: user.email }
  })

  // POST /api/auth/logout
  fastify.post('/logout', async (request, reply) => {
    if (request.user) {
      auditLog(request.user.id, 'logout', { ip: request.clientIp })
    }
    request.session.destroy()
    return { ok: true }
  })

  // GET /api/auth/logout (convenience for link)
  fastify.get('/logout', async (request, reply) => {
    if (request.user) {
      auditLog(request.user.id, 'logout', { ip: request.clientIp })
    }
    request.session.destroy()
    reply.redirect('/login.html')
  })

  // GET /api/auth/me
  fastify.get('/me', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'No autenticado' })
    return { id: request.user.id, username: request.user.username, email: request.user.email }
  })

  // POST /api/auth/register
  fastify.post('/register', async (request, reply) => {
    const { username, email, password } = request.body || {}
    if (!username || !email || !password) {
      return reply.code(400).send({ error: 'Todos los campos son requeridos' })
    }

    // Validate username: alphanumeric + underscore, 3-32 chars
    if (!USERNAME_RE.test(username)) {
      return reply.code(400).send({ error: 'Username debe ser alfanumérico (3-32 caracteres, se permite _)' })
    }

    // Validate email format
    if (!EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: 'Formato de email inválido' })
    }

    // Validate password minimum length
    if (password.length < PASSWORD_MIN) {
      return reply.code(400).send({ error: `Password mínimo ${PASSWORD_MIN} caracteres` })
    }

    const db = getDb()

    // Solo permitir registro si no hay usuarios o si el usuario actual es admin
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count
    if (userCount > 0 && !request.session?.userId) {
      return reply.code(403).send({ error: 'Registro no permitido' })
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email)
    if (existing) {
      return reply.code(409).send({ error: 'Usuario o email ya existe' })
    }

    const hash = bcrypt.hashSync(password, 12)
    const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?,?,?)').run(username, email, hash)

    // Generate default SSH key pair for new user
    const { publicKey, privateKey } = generateUserKeyPair(`${username}@codefromhere`)
    db.prepare('INSERT INTO ssh_keys (user_id, name, private_key, public_key) VALUES (?,?,?,?)')
      .run(result.lastInsertRowid, 'default', encrypt(privateKey), publicKey)

    auditLog(result.lastInsertRowid, 'register', { ip: request.clientIp })

    return { id: result.lastInsertRowid, username, email }
  })

  // PUT /api/auth/password
  fastify.put('/password', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'No autenticado' })
    const { current_password, new_password } = request.body || {}
    if (!current_password || !new_password) {
      return reply.code(400).send({ error: 'Passwords requeridos' })
    }
    if (new_password.length < PASSWORD_MIN) {
      return reply.code(400).send({ error: `Password mínimo ${PASSWORD_MIN} caracteres` })
    }

    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id)
    if (!bcrypt.compareSync(current_password, user.password)) {
      auditLog(request.user.id, 'password_change_failed', { ip: request.clientIp })
      return reply.code(401).send({ error: 'Password actual incorrecto' })
    }

    const hash = bcrypt.hashSync(new_password, 12)
    db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?").run(hash, request.user.id)

    auditLog(request.user.id, 'password_changed', { ip: request.clientIp })

    return { ok: true }
  })
}
