// SQLite-backed store for @fastify/session: sessions survive restarts, can be
// listed and revoked per user (SOC2 CC6.2), and expire server-side.
import { getDb } from '../db/database.js'

export class SqliteSessionStore {
  constructor({ ttlMs }) {
    this.ttlMs = ttlMs
    this.sweep = setInterval(() => {
      try { getDb().prepare('DELETE FROM http_sessions WHERE expires_at < ?').run(Date.now()) } catch {}
    }, 10 * 60 * 1000)
    this.sweep.unref()
  }

  get(sid, cb) {
    try {
      const row = getDb().prepare('SELECT data, expires_at FROM http_sessions WHERE sid = ?').get(sid)
      if (!row || row.expires_at < Date.now()) return cb(null, null)
      cb(null, JSON.parse(row.data))
    } catch (err) { cb(err) }
  }

  set(sid, session, cb) {
    try {
      const now = Date.now()
      const data = JSON.stringify(session)
      getDb().prepare(`INSERT INTO http_sessions (sid, user_id, data, created_at, expires_at, ip, user_agent)
                       VALUES (?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(sid) DO UPDATE SET user_id = excluded.user_id, data = excluded.data,
                         expires_at = excluded.expires_at`)
        .run(sid, session.userId ?? null, data, now, now + this.ttlMs, session.ip ?? null, session.userAgent ?? null)
      cb()
    } catch (err) { cb(err) }
  }

  // Atomic replace only if the stored generation matches (prevents an in-flight
  // request from resurrecting a destroyed or regenerated session).
  compareAndSet(sid, expectedGeneration, session, cb) {
    try {
      const db = getDb()
      const ok = db.transaction(() => {
        const row = db.prepare('SELECT data, expires_at FROM http_sessions WHERE sid = ?').get(sid)
        if (!row || row.expires_at < Date.now()) return false
        const stored = JSON.parse(row.data)
        const generation = stored?.__fastifySessionMetadata?.generation ?? sid
        if (generation !== expectedGeneration) return false
        db.prepare('UPDATE http_sessions SET user_id = ?, data = ?, expires_at = ? WHERE sid = ?')
          .run(session.userId ?? null, JSON.stringify(session), Date.now() + this.ttlMs, sid)
        return true
      })()
      if (!ok) return cb(Object.assign(new Error('The session does not exist or has changed'), { code: 'ENOENT' }))
      cb()
    } catch (err) { cb(err) }
  }

  destroy(sid, cb) {
    try { getDb().prepare('DELETE FROM http_sessions WHERE sid = ?').run(sid); cb() } catch (err) { cb(err) }
  }
}

export function revokeUserSessions(userId, exceptSid = null) {
  getDb().prepare('DELETE FROM http_sessions WHERE user_id = ? AND sid IS NOT ?').run(userId, exceptSid)
}
