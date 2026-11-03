// Tamper-evident audit trail (SOC2 CC7.2 / OWASP ASVS 7.1). Every row stores
// sha256(prev_hash + canonical row), so editing or deleting a row breaks the
// chain and verifyAuditChain() reports where.
import { getDb } from '../db/database.js'
import { sha256 } from './crypto.js'

// Never write secrets into the trail, whatever the caller passes.
const REDACT = /pass(word|phrase)?|secret|token|private_key|access_key|otp|code/i

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const out = Array.isArray(obj) ? [] : {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACT.test(k) ? '[redacted]' : (v && typeof v === 'object' ? redact(v) : v)
  }
  return out
}

const rowPayload = (r) => JSON.stringify([r.user_id, r.connection_id, r.action, r.path, r.ip, r.details, r.created_at])

export function auditLog(userId, action, opts = {}) {
  try {
    const db = getDb()
    const { connectionId = null, path = null, ip = null, ...rest } = opts
    const details = Object.keys(rest).length ? JSON.stringify(redact(rest)) : null
    db.transaction(() => {
      const prev = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get()?.hash || ''
      const row = {
        user_id: userId || 0, connection_id: connectionId, action, path: path ? String(path).slice(0, 1024) : null,
        ip, details, created_at: new Date().toISOString(),
      }
      const hash = sha256(prev + rowPayload(row))
      db.prepare(`INSERT INTO audit_log (user_id, connection_id, action, path, ip, details, created_at, prev_hash, hash)
                  VALUES (@user_id, @connection_id, @action, @path, @ip, @details, @created_at, @prev, @hash)`)
        .run({ ...row, prev, hash })
    })()
  } catch (err) {
    // Audit failures must be visible to operators but never break the request.
    console.error('[audit] write failed:', err.message)
  }
}

/** Returns { ok, checked, brokenAt } – rows written before v2 (hash NULL) are skipped. */
export function verifyAuditChain() {
  const db = getDb()
  let prev = ''
  let checked = 0
  for (const r of db.prepare('SELECT * FROM audit_log WHERE hash IS NOT NULL ORDER BY id').iterate()) {
    if (r.prev_hash !== prev || sha256(prev + rowPayload(r)) !== r.hash) return { ok: false, checked, brokenAt: r.id }
    prev = r.hash
    checked++
  }
  return { ok: true, checked, brokenAt: null }
}
