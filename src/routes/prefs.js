// Per-user preferences (Hyper-style JSON config) and the saved UI layout.
import { getDb } from '../db/database.js'

const MAX_JSON = 512 * 1024

export default async function prefsRoutes(fastify) {
  fastify.get('/', async (request) => {
    const row = getDb().prepare('SELECT config_json, layout_json, updated_at FROM user_prefs WHERE user_id = ?').get(request.user.id)
    return {
      config: row ? JSON.parse(row.config_json || '{}') : {},
      layout: row?.layout_json ? JSON.parse(row.layout_json) : null,
      updated_at: row?.updated_at || null,
    }
  })

  fastify.put('/config', async (request, reply) => {
    const json = JSON.stringify(request.body ?? {})
    if (json.length > MAX_JSON) return reply.code(413).send({ error: 'Config too large' })
    getDb().prepare(`INSERT INTO user_prefs (user_id, config_json) VALUES (?, ?)
                     ON CONFLICT(user_id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')`)
      .run(request.user.id, json)
    return { ok: true }
  })

  fastify.put('/layout', async (request, reply) => {
    const json = JSON.stringify(request.body ?? null)
    if (json.length > MAX_JSON * 4) return reply.code(413).send({ error: 'Layout too large' })
    getDb().prepare(`INSERT INTO user_prefs (user_id, layout_json) VALUES (?, ?)
                     ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = datetime('now')`)
      .run(request.user.id, json)
    return { ok: true }
  })
}
