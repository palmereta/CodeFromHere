import { createSession, getSession, listSessions } from '../sessions/registry.js'
import { AGENTS } from '../sessions/agents.js'
import { errorPayload } from '../services/sshConnect.js'
import { config } from '../config.js'

const KINDS = ['local', 'ssh', 'telnet']

export default async function sessionRoutes(fastify) {
  fastify.get('/', async (request) => listSessions(request.user.id))

  fastify.get('/capabilities', async () => ({
    localShell: config.allowLocalShell,
    agents: Object.entries(AGENTS).map(([id, a]) => ({ id, label: a.label })),
    platform: process.platform,
    mode: config.mode,
  }))

  fastify.post('/', async (request, reply) => {
    const b = request.body || {}
    if (!KINDS.includes(b.kind)) return reply.code(400).send({ error: 'Invalid kind' })
    if (b.kind !== 'local' && !Number.isInteger(Number(b.connectionId))) return reply.code(400).send({ error: 'connectionId required' })
    const str = (v, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : undefined)
    try {
      const s = await createSession(request.user.id, {
        kind: b.kind,
        connectionId: b.kind === 'local' ? null : Number(b.connectionId),
        cwd: str(b.cwd),
        cols: Number(b.cols) || 120,
        rows: Number(b.rows) || 32,
        agent: str(b.agent, 32) || 'shell',
        agentArgs: str(b.agentArgs, 2048),
        agentSessionId: str(b.agentSessionId, 128),
        resume: b.resume && typeof b.resume === 'object'
          ? { id: str(b.resume.id, 128), last: !!b.resume.last } : undefined,
        tmux: !!b.tmux,
        tmuxName: str(b.tmuxName, 64)?.replace(/[^a-zA-Z0-9_-]/g, ''),
        title: str(b.title, 200),
        command: str(b.command, 4096),
      })
      return s.info()
    } catch (err) {
      return reply.code(err.statusCode || 502).send(errorPayload(err))
    }
  })

  fastify.delete('/:id', async (request, reply) => {
    const s = getSession(request.params.id, request.user.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    s.kill('closed-by-user')
    return { ok: true }
  })

  fastify.patch('/:id', async (request, reply) => {
    const s = getSession(request.params.id, request.user.id)
    if (!s) return reply.code(404).send({ error: 'Not found' })
    if (typeof request.body?.title === 'string') s.title = request.body.title.slice(0, 200)
    return s.info()
  })
}

// WebSocket: /ws/session/:id?since=<offset>
// Binary frames = terminal bytes both ways. Text frames = JSON control.
export function sessionSocket(socket, request) {
  const s = getSession(request.params.id, request.user?.id)
  if (!s) { socket.close(4404, 'Session not found'); return }
  const since = request.query?.since !== undefined ? Number(request.query.since) : undefined
  s.attach(socket, since)

  socket.on('message', (data, isBinary) => {
    if (isBinary) return s.write(data)
    let msg
    try { msg = JSON.parse(data.toString()) } catch { return }
    if (msg.t === 'resize') s.resize(msg.cols, msg.rows)
    else if (msg.t === 'input' && typeof msg.data === 'string') s.write(msg.data)
    else if (msg.t === 'ping') socket.send(JSON.stringify({ t: 'pong' }))
  })
  socket.on('close', () => s.detach(socket))
  socket.on('error', () => s.detach(socket))
}
