import { describe, it, expect, beforeAll } from 'vitest'
import { createCipheriv, randomBytes } from 'node:crypto'
import { initDatabase, getDb } from '../src/db/database.js'
import { encrypt, decrypt, isLegacyCiphertext } from '../src/security/crypto.js'
import { auditLog, verifyAuditChain } from '../src/security/audit.js'
import { resolveWorkspace, composePrompt } from '../src/sessions/agents.js'

beforeAll(() => { initDatabase() })

describe('crypto', () => {
  it('round-trips v2 and uses a fresh IV', () => {
    const a = encrypt('s3cret'), b = encrypt('s3cret')
    expect(a.startsWith('v2:')).toBe(true)
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('s3cret')
  })

  it('rejects tampered ciphertext', () => {
    const c = encrypt('s3cret')
    const raw = Buffer.from(c.slice(3), 'base64url'); raw[raw.length - 1] ^= 1
    expect(() => decrypt('v2:' + raw.toString('base64url'))).toThrow()
  })

  it('still reads v1 values', () => {
    const key = Buffer.from(process.env.ENCRYPTION_KEY.slice(0, 32))
    const iv = randomBytes(16)
    const ci = createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([ci.update('legacy', 'utf8'), ci.final()])
    const v1 = iv.toString('hex') + ci.getAuthTag().toString('hex') + ct.toString('hex')
    expect(isLegacyCiphertext(v1)).toBe(true)
    expect(decrypt(v1)).toBe('legacy')
  })
})

describe('audit chain', () => {
  it('detects edits and redacts secrets', () => {
    auditLog(1, 'test_one', { ip: '1.2.3.4', password: 'hunter2', nested: { token: 'x' } })
    auditLog(1, 'test_two', { path: '/etc' })
    expect(verifyAuditChain().ok).toBe(true)
    const row = getDb().prepare("SELECT * FROM audit_log WHERE action = 'test_one'").get()
    expect(row.details).not.toContain('hunter2')
    expect(row.details).toContain('[redacted]')
    getDb().prepare("UPDATE audit_log SET path = '/tampered' WHERE action = 'test_two'").run()
    expect(verifyAuditChain().ok).toBe(false)
  })
})

describe('workspaces', () => {
  it('resolves exact, inherited and deepest ancestor', () => {
    const db = getDb()
    db.prepare("INSERT INTO workspaces (user_id, path, name, system_prompt, inherit) VALUES (1, '/srv/app', 'app', 'APP', 1)").run()
    db.prepare("INSERT INTO workspaces (user_id, path, name, system_prompt, inherit) VALUES (1, '/srv/app/api', 'api', 'API', 0)").run()
    expect(resolveWorkspace(1, null, '/srv/app/web').name).toBe('app')
    expect(resolveWorkspace(1, null, '/srv/app/api').name).toBe('api')
    expect(resolveWorkspace(1, null, '/srv/app/api/sub').name).toBe('app') // api does not inherit
    expect(resolveWorkspace(1, null, '/srv/application')).toBeNull()       // prefix, not ancestor
    expect(composePrompt(1, resolveWorkspace(1, null, '/srv/app'))).toBe('APP')
  })
})
