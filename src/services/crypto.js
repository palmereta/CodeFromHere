import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey() {
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length < 32) {
    throw new Error('ENCRYPTION_KEY debe tener al menos 32 caracteres en .env')
  }
  return Buffer.from(key.slice(0, 32))
}

export function encrypt(text) {
  if (!text) return null
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex')
}

export function decrypt(data) {
  if (!data) return null
  const iv  = Buffer.from(data.slice(0, 32), 'hex')
  const tag = Buffer.from(data.slice(32, 64), 'hex')
  const enc = Buffer.from(data.slice(64), 'hex')
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(tag)
  return decipher.update(enc) + decipher.final('utf8')
}

export function decryptConnection(conn) {
  return {
    ...conn,
    password:    decrypt(conn.password),
    private_key: decrypt(conn.private_key),
    passphrase:  decrypt(conn.passphrase),
    access_key:  decrypt(conn.access_key),
    secret_key:  decrypt(conn.secret_key),
  }
}
