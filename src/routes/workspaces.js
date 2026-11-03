// Per-folder AI workspaces: system prompt, default agent, env and saved context.
import { getDb } from '../db/database.js'
import { auditLog } from '../security/audit.js'
import { resolveWorkspace, composePrompt, AGENTS } from '../sessions/agents.js'

const FIELDS = ['name', 'path', 'connection_id', 'system_prompt', 'agent', 'agent_args', 'env_json', 'context', 'inherit']

function clean(body) {
  const out = {}
  for (const f of FIELDS) if (body[f] !== undefined) out[f] = body[f]
  if (out.connection_id !== undefined) out.connection_id = out.connection_id ? Number(out.connection_id) : null
  if (out.inherit !== undefined) out.inherit = out.inherit ? 1 : 0
  if (out.agent && !AGENTS[out.agent]) throw Object.assign(new Error('Unknown agent'), { statusCode: 400 })
  for (const f of ['system_prompt', 'context']) if (typeof out[f] === 'string' && out[f].length > 200_000) throw Object.assign(new Error(`${f} too long`), { statusCode: 413 })
  return out
}

function ownsConnection(userId, connectionId) {
  return !connectionId || !!getDb().prepare('SELECT 1 FROM connections WHERE id = ? AND user_id = ?').get(connectionId, userId)
}

export default async function workspaceRoutes(fastify) {
  fastify.get('/', async (request) => getDb().prepare('SELECT * FROM workspaces WHERE user_id = ? ORDER BY name').all(request.user.id))

  // Which workspace (and final prompt) applies to a folder.
  fastify.get('/resolve', async (request) => {
    const { connection_id, path } = request.query
    const ws = resolveWorkspace(request.user.id, connection_id ? Number(connection_id) : null, path)
    return { workspace: ws, prompt: composePrompt(request.user.id, ws) }
  })

  fastify.post('/', async (request, reply) => {
    let data
    try { data = clean(request.body || {}) } catch (e) { return reply.code(e.statusCode).send({ error: e.message }) }
    if (!data.path) return reply.code(400).send({ error: 'path required' })
    if (!ownsConnection(request.user.id, data.connection_id)) return reply.code(404).send({ error: 'Connection not found' })
    data.name ||= data.path.split(/[\\/]/).filter(Boolean).pop() || data.path
    try {
      const id = getDb().prepare(`INSERT INTO workspaces (user_id, ${Object.keys(data).join(', ')}) VALUES (@user_id, ${Object.keys(data).map(k => '@' + k).join(', ')})`)
        .run({ user_id: request.user.id, ...data }).lastInsertRowid
      auditLog(request.user.id, 'workspace_created', { connectionId: data.connection_id, path: data.path })
      return { id }
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return reply.code(409).send({ error: 'A workspace for this folder already exists' })
      throw e
    }
  })

  fastify.put('/:id', async (request, reply) => {
    let data
    try { data = clean(request.body || {}) } catch (e) { return reply.code(e.statusCode).send({ error: e.message }) }
    if (!ownsConnection(request.user.id, data.connection_id)) return reply.code(404).send({ error: 'Connection not found' })
    if (!Object.keys(data).length) return { ok: true }
    const r = getDb().prepare(`UPDATE workspaces SET ${Object.keys(data).map(k => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id AND user_id = @user_id`)
      .run({ ...data, id: Number(request.params.id), user_id: request.user.id })
    if (!r.changes) return reply.code(404).send({ error: 'Not found' })
    auditLog(request.user.id, 'workspace_updated', { path: data.path, workspace: Number(request.params.id) })
    return { ok: true }
  })

  fastify.delete('/:id', async (request, reply) => {
    const r = getDb().prepare('DELETE FROM workspaces WHERE id = ? AND user_id = ?').run(Number(request.params.id), request.user.id)
    if (!r.changes) return reply.code(404).send({ error: 'Not found' })
    auditLog(request.user.id, 'workspace_deleted', { workspace: Number(request.params.id) })
    return { ok: true }
  })
}
