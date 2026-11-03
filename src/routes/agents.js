import { listAgentHistory } from '../services/agentHistory.js'
import { config } from '../config.js'

export default async function agentRoutes(fastify) {
  // Previous conversations stored on the machine running the server.
  fastify.get('/history', async (request, reply) => {
    if (!config.allowLocalShell || (config.mode === 'web' && request.user.role !== 'admin')) {
      return reply.code(403).send({ error: 'Agent history is only available for the local machine' })
    }
    const { agent, cwd } = request.query
    return listAgentHistory({ agent: ['claude', 'codex', 'opencode'].includes(agent) ? agent : undefined, cwd: typeof cwd === 'string' && cwd ? cwd : undefined })
  })
}
