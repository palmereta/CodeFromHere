import Database from 'better-sqlite3'
import { readFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { generateUserKeyPair } from '../services/sshKeygen.js'
import { encrypt } from '../services/crypto.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
let db

export function initDatabase() {
  mkdirSync(join(__dirname, '../../data'), { recursive: true })
  db = new Database(join(__dirname, '../../data/cubiq.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  db.exec(schema)

  // Seed: usuario admin si no existe
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
  if (!admin) {
    // Generate a secure random password on first run
    const defaultPass = randomBytes(16).toString('base64url')
    const hash = bcrypt.hashSync(defaultPass, 12)
    const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?,?,?)')
      .run('admin', 'admin@codefromhere', hash)
    console.log('')
    console.log('╔══════════════════════════════════════════════════╗')
    console.log('║  Admin account created                          ║')
    console.log('║                                                 ║')
    console.log(`║  User:     admin                                ║`)
    console.log(`║  Password: ${defaultPass.padEnd(37)}║`)
    console.log('║                                                 ║')
    console.log('║  Save this password! It won\'t be shown again.   ║')
    console.log('║  Change it in Settings after first login.       ║')
    console.log('╚══════════════════════════════════════════════════╝')
    console.log('')

    // Generate default SSH key pair for admin
    const { publicKey, privateKey } = generateUserKeyPair('admin@codefromhere')
    db.prepare('INSERT INTO ssh_keys (user_id, name, private_key, public_key) VALUES (?,?,?,?)')
      .run(result.lastInsertRowid, 'default', encrypt(privateKey), publicKey)
    console.log('SSH key pair generated for admin')
  }

  // Ensure every existing user has a default SSH key pair
  const usersWithoutKey = db.prepare(`
    SELECT u.id, u.username FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM ssh_keys sk WHERE sk.user_id = u.id AND sk.name = 'default')
  `).all()
  for (const user of usersWithoutKey) {
    const { publicKey, privateKey } = generateUserKeyPair(`${user.username}@codefromhere`)
    db.prepare('INSERT INTO ssh_keys (user_id, name, private_key, public_key) VALUES (?,?,?,?)')
      .run(user.id, 'default', encrypt(privateKey), publicKey)
    console.log(`Clave SSH generada para ${user.username}`)
  }

  return db
}

export function getDb() {
  if (!db) throw new Error('Database not initialized')
  return db
}
