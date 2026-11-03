import 'dotenv/config'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import fastifyCookie from '@fastify/cookie'
import fastifySession from '@fastify/session'
import fastifyRateLimit from '@fastify/rate-limit'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

import { config, SESSION_SECRET } from './src/config.js'
import { initDatabase } from './src/db/database.js'
import { registerHttpHardening } from './src/security/http.js'
import { registerAuth } from './src/security/auth.js'
import { SqliteSessionStore } from './src/security/sessionStore.js'
import authRoutes from './src/routes/auth.js'
import adminRoutes from './src/routes/admin.js'
import connectionsRoutes from './src/routes/connections.js'
import filesRoutes from './src/routes/files.js'
import settingsRoutes from './src/routes/settings.js'
import prefsRoutes from './src/routes/prefs.js'
import workspaceRoutes from './src/routes/workspaces.js'
import sessionRoutes, { sessionSocket } from './src/routes/sessions.js'
import transferRoutes, { transferSocket } from './src/routes/transfers.js'
import agentRoutes from './src/routes/agents.js'
import { killAll } from './src/sessions/registry.js'
import { cancelAll } from './src/transfers/engine.js'
import { closePool } from './src/services/vfs/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UI_DIR = join(__dirname, 'dist', 'ui')

export async function buildServer() {
  initDatabase()

  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    trustProxy: config.trustProxy,
    bodyLimit: 20 * 1024 * 1024,
  })

  await fastify.register(fastifyRateLimit, { global: true, max: 1200, timeWindow: '1 minute' })
  await fastify.register(fastifyCookie)
  await fastify.register(fastifySession, {
    secret: SESSION_SECRET,
    cookieName: config.secureCookies ? '__Host-cfh' : 'cfh.sid',
    store: new SqliteSessionStore({ ttlMs: config.sessionIdleMinutes * 60_000 }),
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: config.secureCookies,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: config.sessionIdleMinutes * 60_000,
    },
  })
  await fastify.register(fastifyMultipart, { limits: { fileSize: config.uploadLimitBytes, files: 500 } })
  await fastify.register(fastifyWebsocket, { options: { maxPayload: 4 * 1024 * 1024 } })

  registerHttpHardening(fastify)
  registerAuth(fastify)

  await fastify.register(authRoutes, { prefix: '/api/auth' })
  await fastify.register(adminRoutes, { prefix: '/api/admin' })
  await fastify.register(connectionsRoutes, { prefix: '/api/connections' })
  await fastify.register(filesRoutes, { prefix: '/api/files' })
  await fastify.register(settingsRoutes, { prefix: '/api/settings' })
  await fastify.register(prefsRoutes, { prefix: '/api/prefs' })
  await fastify.register(workspaceRoutes, { prefix: '/api/workspaces' })
  await fastify.register(sessionRoutes, { prefix: '/api/sessions' })
  await fastify.register(transferRoutes, { prefix: '/api/transfers' })
  await fastify.register(agentRoutes, { prefix: '/api/agents' })

  fastify.register(async (app) => {
    app.get('/ws/session/:id', { websocket: true }, sessionSocket)
    app.get('/ws/transfers', { websocket: true }, transferSocket)
  })

  fastify.get('/healthz', async () => ({ ok: true }))

  if (existsSync(UI_DIR)) {
    await fastify.register(fastifyStatic, { root: UI_DIR, prefix: '/', index: ['index.html'] })
    // SPA fallback
    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws/')) return reply.code(404).send({ error: 'Not found' })
      return reply.sendFile('index.html')
    })
  } else {
    fastify.get('/', async () => 'UI not built. Run `npm run build` (or `npm run dev` for the Vite dev server).')
  }

  fastify.setErrorHandler((err, request, reply) => {
    request.log.error(err)
    const status = err.statusCode && err.statusCode < 600 ? err.statusCode : 500
    // Do not leak internals on 5xx (OWASP ASVS 7.4).
    reply.code(status).send({ error: status >= 500 ? 'Internal error' : err.message })
  })

  return fastify
}

const isMain = !!process.parentPort || process.env.CFH_MODE === 'desktop' ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
if (isMain) {
  const fastify = await buildServer()
  await fastify.listen({ port: config.port, host: config.host })
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host
  console.log(`CodeFromHere ${config.mode} mode → http://${shown}:${fastify.server.address().port}`)
  const listening = { type: 'listening', port: fastify.server.address().port }
  if (process.parentPort) process.parentPort.postMessage(listening) // Electron utilityProcess
  else if (process.send) process.send(listening)

  process.on('unhandledRejection', (err) => fastify.log.error({ err }, 'unhandled rejection'))
  const shutdown = async (signal) => {
    fastify.log.info(`${signal}: shutting down`)
    cancelAll(); killAll(); closePool()
    await fastify.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
