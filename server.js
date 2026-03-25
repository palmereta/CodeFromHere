import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import fastifyCookie from '@fastify/cookie'
import fastifySession from '@fastify/session'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import dotenv from 'dotenv'

import { initDatabase } from './src/db/database.js'
import { authMiddleware } from './src/middleware/auth.js'
import authRoutes from './src/routes/auth.js'
import connectionsRoutes from './src/routes/connections.js'
import filesRoutes from './src/routes/files.js'
import terminalRoutes from './src/routes/terminal.js'
import settingsRoutes from './src/routes/settings.js'
import { sshBridgeHandler, activeSessions } from './src/ws/sshBridge.js'

dotenv.config()
const __dirname = dirname(fileURLToPath(import.meta.url))

export async function startServer(port) {

const fastify = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  bodyLimit: 100 * 1024 * 1024, // 100MB para uploads
})

// Plugins
await fastify.register(fastifyCookie)
await fastify.register(fastifySession, {
  secret: process.env.SESSION_SECRET || randomUUID() + randomUUID(),
  cookie: { secure: false, httpOnly: true, sameSite: 'lax', maxAge: 86400000 * 7 }, // 7 dias
  saveUninitialized: false,
})
await fastify.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024 } })
await fastify.register(fastifyWebsocket)
await fastify.register(fastifyStatic, {
  root: join(__dirname, 'public'),
  prefix: '/',
})

// Security headers (Helmet-like, no extra dependency)
fastify.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('X-XSS-Protection', '1; mode=block')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (process.env.ENABLE_HSTS === '1') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://fonts.googleapis.com; font-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:;")
})

// CORS restriction: same-origin only (block cross-origin API requests)
fastify.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin
  if (origin && request.url.startsWith('/api/')) {
    const host = request.headers.host
    const originHost = origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
    if (originHost !== host) {
      reply.code(403).send({ error: 'Cross-origin requests not allowed' })
      return
    }
  }
})

// Auth middleware global
authMiddleware(fastify)

// Redirect root a login si no hay sesion
fastify.get('/', async (request, reply) => {
  if (!request.session?.userId) {
    return reply.redirect('/login.html')
  }
  return reply.sendFile('index.html')
})

// Rutas API
await fastify.register(authRoutes, { prefix: '/api/auth' })
await fastify.register(connectionsRoutes, { prefix: '/api/connections' })
await fastify.register(filesRoutes, { prefix: '/api/files' })
await fastify.register(terminalRoutes, { prefix: '/api/terminal' })
await fastify.register(settingsRoutes, { prefix: '/api/settings' })

// WebSocket SSH Bridge — mismo puerto, path /ws/terminal
fastify.get('/ws/terminal', { websocket: true }, sshBridgeHandler)

// Init DB y arrancar
await initDatabase()

const host = process.env.HOST || '0.0.0.0'

await fastify.listen({ port: port || parseInt(process.env.PORT || '3000'), host })
const actualPort = fastify.server.address().port
console.log(`CodeFromHere corriendo en http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`)

// Evitar que errores no capturados maten el proceso
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (no crash):', err.message)
})
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (no crash):', err?.message || err)
})

// Cleanup en shutdown: cerrar todas las sesiones SSH activas
function gracefulShutdown(signal) {
  console.log(`\n${signal} recibido — cerrando sesiones SSH...`)
  for (const [id, session] of activeSessions) {
    try { session.stream?.end() } catch {}
    try { session.sshClient?.end() } catch {}
    try { session.ws?.close() } catch {}
  }
  activeSessions.clear()
  fastify.close().then(() => {
    console.log('CodeFromHere cerrado correctamente')
    process.exit(0)
  })
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

return actualPort
}

// Auto-start in standalone mode only (Electron calls startServer() directly)
if (!process.env.ELECTRON) {
  startServer(parseInt(process.env.PORT || '3000'))
}
