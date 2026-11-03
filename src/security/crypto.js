// Credential encryption at rest (SOC2 CC6.1 / OWASP ASVS 6.2).
//
// Format v2: "v2:" + base64url(iv[12] | tag[16] | ciphertext), AES-256-GCM with
// a key derived from ENCRYPTION_KEY through scrypt. Values written by v1
// (hex iv[16] | tag | ct, key = first 32 chars of the secret) are still
// readable and get re-encrypted by the v2 migration.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto'
import { ENCRYPTION_KEY } from '../config.js'

const ALGO = 'aes-256-gcm'
const KEY_V2 = scryptSync(ENCRYPTION_KEY, 'codefromhere/credentials/v2', 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
const KEY_V1 = Buffer.from(ENCRYPTION_KEY.slice(0, 32))

export const SECRET_FIELDS = ['password', 'private_key', 'passphrase', 'access_key', 'secret_key']

export function encrypt(text) {
  if (text === null || text === undefined || text === '') return null
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, KEY_V2, iv)
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  return 'v2:' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
}

export function decrypt(data) {
  if (!data) return null
  if (data.startsWith('v2:')) {
    const raw = Buffer.from(data.slice(3), 'base64url')
    const decipher = createDecipheriv(ALGO, KEY_V2, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  }
  // Legacy v1
  const decipher = createDecipheriv(ALGO, KEY_V1, Buffer.from(data.slice(0, 32), 'hex'))
  decipher.setAuthTag(Buffer.from(data.slice(32, 64), 'hex'))
  return decipher.update(Buffer.from(data.slice(64), 'hex'), undefined, 'utf8') + decipher.final('utf8')
}

export const isLegacyCiphertext = (data) => !!data && !data.startsWith('v2:')

export function decryptConnection(conn) {
  const out = { ...conn }
  for (const f of SECRET_FIELDS) out[f] = decrypt(conn[f])
  return out
}

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b))
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
