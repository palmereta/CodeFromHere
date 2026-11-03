// HTTP hardening shared by every route (OWASP ASVS 14.4 / 13.2 / 4.2).
import { config } from '../config.js'

// No CDNs: every script/style/font is bundled and served from 'self'.
// 'unsafe-inline' for styles is required by Monaco and dockview, which set
// element styles at runtime; scripts stay strict.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

export function registerHttpHardening(fastify) {
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Cross-Origin-Opener-Policy', 'same-origin')
    reply.header('Cross-Origin-Resource-Policy', 'same-origin')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    reply.header('Content-Security-Policy', CSP)
    if (config.hsts) reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
  })

  // CSRF defence for a JSON API: state-changing requests must carry a custom
  // header (cross-site forms cannot set it, and cross-origin fetch would need a
  // CORS preflight we never grant) and, when an Origin is sent, it must match.
  fastify.addHook('onRequest', async (request, reply) => {
    const isApi = request.url.startsWith('/api/')
    const isWs = request.url.startsWith('/ws/')
    if (!isApi && !isWs) return

    if (!sameOrigin(request)) {
      return reply.code(403).send({ error: 'Cross-origin request blocked' })
    }
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    if (isApi && unsafe && request.headers['x-cfh-csrf'] !== '1') {
      return reply.code(403).send({ error: 'Missing CSRF header' })
    }
  })
}

/** True when there is no Origin header (same-origin GET, CLI) or it matches Host. */
export function sameOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return !request.url.startsWith('/ws/') // browsers always send Origin on WS
  try {
    const host = request.headers['x-forwarded-host'] && config.trustProxy ? request.headers['x-forwarded-host'] : request.headers.host
    return new URL(origin).host === host
  } catch { return false }
}
