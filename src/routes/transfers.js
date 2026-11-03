import { createJob, listJobs, getJob, controlJob, compareDirs, bus, POLICIES } from '../transfers/engine.js'
import { errorPayload } from '../services/sshConnect.js'

const srcId = (s) => (s === 'local' ? 'local' : Number(s))

function cleanEndpoint(e, key) {
  if (!e || typeof e !== 'object') throw Object.assign(new Error(`${key} required`), { statusCode: 400 })
  const source = srcId(e.source)
  if (source !== 'local' && !Number.isInteger(source)) throw Object.assign(new Error(`${key}.source invalid`), { statusCode: 400 })
  return { ...e, source }
}

export default async function transferRoutes(fastify) {
  fastify.get('/', async (request) => listJobs(request.user.id))
  fastify.get('/policies', async () => POLICIES)

  // { items: [{ src: {source, path, isDir, size?, modified?}, dst: {source, dir} }], mode, policy, concurrency }
  fastify.post('/', async (request, reply) => {
    try {
      const b = request.body || {}
      const items = (b.items || []).slice(0, 10_000).map(it => ({ src: cleanEndpoint(it.src, 'src'), dst: cleanEndpoint(it.dst, 'dst') }))
      for (const it of items) {
        if (typeof it.src.path !== 'string' || typeof it.dst.dir !== 'string') throw Object.assign(new Error('src.path and dst.dir required'), { statusCode: 400 })
      }
      return createJob(request.user, { items, mode: b.mode, policy: b.policy, concurrency: b.concurrency, preserveTimes: b.preserveTimes !== false })
    } catch (err) {
      return reply.code(err.statusCode || 400).send(errorPayload(err))
    }
  })

  fastify.get('/:id', async (request, reply) => getJob(request.params.id, request.user.id) || reply.code(404).send({ error: 'Not found' }))

  fastify.post('/:id/:action', async (request, reply) => {
    if (!['pause', 'resume', 'cancel', 'retry', 'remove'].includes(request.params.action)) return reply.code(400).send({ error: 'Invalid action' })
    return controlJob(request.params.id, request.user.id, request.params.action) || reply.code(404).send({ error: 'Not found' })
  })

  fastify.post('/compare', async (request, reply) => {
    try {
      const { left, right } = request.body || {}
      return await compareDirs(request.user, cleanEndpoint(left, 'left'), cleanEndpoint(right, 'right'))
    } catch (err) {
      return reply.code(err.statusCode || 502).send(errorPayload(err))
    }
  })
}

// WS /ws/transfers — live job summaries for the current user.
export function transferSocket(socket, request) {
  const userId = request.user?.id
  if (!userId) { socket.close(4401, 'Not authenticated'); return }
  const onJob = (uid, summary) => { if (uid === userId && socket.readyState === 1) socket.send(JSON.stringify(summary)) }
  bus.on('job', onJob)
  socket.on('close', () => bus.off('job', onJob))
}
