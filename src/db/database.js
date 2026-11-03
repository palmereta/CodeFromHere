import Database from './sqlite.js'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { DATA_DIR, MODE } from '../config.js'
import { generateUserKeyPair } from '../services/sshKeygen.js'
import { encrypt, decrypt, isLegacyCiphertext, SECRET_FIELDS } from '../security/crypto.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
let db

/** Applies migrations/NNN_*.sql in order, tracked through PRAGMA user_version. */
function migrate() {
  const dir = join(__dirname, 'migrations')
  const files = readdirSync(dir).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()
  const current = db.pragma('user_version', { simple: true })
  db.pragma('foreign_keys = OFF')
  for (const file of files) {
    const version = parseInt(file.slice(0, 3), 10)
    if (version <= current) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      if (version === 2) reencryptLegacySecrets()
      db.pragma(`user_version = ${version}`)
    })()
    console.log(`[db] migration ${file} applied`)
  }
  db.pragma('foreign_keys = ON')
  const problems = db.pragma('foreign_key_check')
  if (problems.length) console.warn('[db] foreign key problems after migration:', problems.length)
}

function reencryptLegacySecrets() {
  const rows = db.prepare(`SELECT id, ${SECRET_FIELDS.join(', ')} FROM connections`).all()
  const upd = db.prepare(`UPDATE connections SET ${SECRET_FIELDS.map(f => `${f} = @${f}`).join(', ')} WHERE id = @id`)
  for (const row of rows) {
    const next = { id: row.id }
    let changed = false
    for (const f of SECRET_FIELDS) {
      next[f] = row[f]
      if (isLegacyCiphertext(row[f])) { next[f] = encrypt(decrypt(row[f])); changed = true }
    }
    if (changed) upd.run(next)
  }
  for (const key of db.prepare('SELECT id, private_key FROM ssh_keys').all()) {
    if (isLegacyCiphertext(key.private_key)) {
      db.prepare('UPDATE ssh_keys SET private_key = ? WHERE id = ?').run(encrypt(decrypt(key.private_key)), key.id)
    }
  }
}

function ensureDefaultKey(userId, username) {
  const has = db.prepare("SELECT 1 FROM ssh_keys WHERE user_id = ? AND name = 'default'").get(userId)
  if (has) return
  const { publicKey, privateKey } = generateUserKeyPair(`${username}@codefromhere`)
  db.prepare('INSERT INTO ssh_keys (user_id, name, private_key, public_key) VALUES (?,?,?,?)')
    .run(userId, 'default', encrypt(privateKey), publicKey)
}

export function initDatabase() {
  db = new Database(join(DATA_DIR, 'codefromhere.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  migrate()

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  if (userCount === 0) {
    // Desktop: single local user, logged in through the Electron token, so the
    // password is random and never shown. Web: print it once on first boot.
    const password = randomBytes(18).toString('base64url')
    const id = db.prepare("INSERT INTO users (username, email, password, role, password_changed_at) VALUES (?,?,?,'admin',datetime('now'))")
      .run(MODE === 'desktop' ? 'local' : 'admin', MODE === 'desktop' ? 'local@codefromhere' : 'admin@codefromhere', bcrypt.hashSync(password, 12))
      .lastInsertRowid
    if (MODE === 'web') {
      console.log('\n  Admin account created  →  user: admin   password: ' + password)
      console.log('  Save it now: it will not be shown again. Change it under Settings → Account.\n')
    }
    ensureDefaultKey(id, MODE === 'desktop' ? 'local' : 'admin')
  }
  for (const u of db.prepare('SELECT id, username FROM users').all()) ensureDefaultKey(u.id, u.username)
  return db
}

export function getDb() {
  if (!db) throw new Error('Database not initialized')
  return db
}
