import { Client } from 'ssh2'
import { getDb } from '../db/database.js'
import { decryptConnection, decrypt } from '../services/crypto.js'
import { auditLog } from '../middleware/auth.js'

// Map de sessions activas para cleanup en SIGTERM
export const activeSessions = new Map()

// WebSocket rate limiting per user: max 5 concurrent connections
const wsConnectionCounts = new Map() // userId -> count
const WS_MAX_PER_USER = 5

// Idle timeout: 30 minutes
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

// Helper: enviar mensaje por WebSocket solo si está abierto
function wsSend(ws, data) {
  try {
    if (ws && ws.readyState === 1) ws.send(data)
  } catch {}
}

function wsClose(ws) {
  try {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) ws.close()
  } catch {}
}

function decrementWsCount(userId) {
  const count = wsConnectionCounts.get(userId) || 0
  if (count <= 1) {
    wsConnectionCounts.delete(userId)
  } else {
    wsConnectionCounts.set(userId, count - 1)
  }
}

// @fastify/websocket v8: handler recibe (connection, request)
// connection es un SocketStream, el WebSocket real está en connection.socket
export async function sshBridgeHandler(connection, request) {
  const ws = connection.socket

  const url   = new URL(request.url, `http://${request.headers.host}`)
  const token = url.searchParams.get('token')

  if (!token) {
    wsSend(ws, JSON.stringify({ type: 'error', message: 'Token requerido' }))
    wsClose(ws)
    return
  }

  // Buscar y validar token en DB
  const db       = getDb()
  const tokenRow = db.prepare(`
    SELECT * FROM terminal_tokens
    WHERE token = ? AND used = 0 AND expires_at > datetime('now')
  `).get(token)

  if (!tokenRow) {
    wsSend(ws, JSON.stringify({ type: 'error', message: 'Token invalido o expirado' }))
    wsClose(ws)
    return
  }

  // Marcar token como usado (single-use)
  db.prepare('UPDATE terminal_tokens SET used = 1 WHERE token = ?').run(token)

  // Rate limiting: check concurrent WebSocket connections per user
  const currentCount = wsConnectionCounts.get(tokenRow.user_id) || 0
  if (currentCount >= WS_MAX_PER_USER) {
    auditLog(tokenRow.user_id, 'ssh_ws_rate_limited', {
      connectionId: tokenRow.connection_id,
      ip: request.ip || 'unknown',
    })
    wsSend(ws, JSON.stringify({ type: 'error', message: 'Demasiadas conexiones de terminal activas' }))
    wsClose(ws)
    return
  }
  wsConnectionCounts.set(tokenRow.user_id, currentCount + 1)

  // Obtener connection
  const connRow = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
    .get(tokenRow.connection_id, tokenRow.user_id)

  if (!connRow || connRow.type !== 'sftp') {
    decrementWsCount(tokenRow.user_id)
    wsSend(ws, JSON.stringify({ type: 'error', message: 'Solo SSH/SFTP soporta terminal' }))
    wsClose(ws)
    return
  }

  const conn = decryptConnection(connRow)
  const sessionId = token

  auditLog(tokenRow.user_id, 'ssh_connect', {
    connectionId: tokenRow.connection_id,
    path: tokenRow.initial_path,
    ip: request.ip || 'unknown',
  })

  // Establecer conexión SSH
  const sshClient = new Client()

  sshClient.on('ready', () => {
    wsSend(ws, JSON.stringify({ type: 'status', message: 'Conectado' }))

    sshClient.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
      if (err) {
        decrementWsCount(tokenRow.user_id)
        wsSend(ws, JSON.stringify({ type: 'error', message: err.message }))
        wsClose(ws)
        return
      }

      // Navegar al path inicial
      if (tokenRow.initial_path && tokenRow.initial_path !== '/') {
        stream.write(`cd "${tokenRow.initial_path.replace(/"/g, '\\"')}"\n`)
      }

      // Idle timeout management
      let idleTimer = setTimeout(() => {
        wsSend(ws, JSON.stringify({ type: 'status', message: 'Sesión cerrada por inactividad (30 min)' }))
        try { stream.end() } catch {}
        try { sshClient.end() } catch {}
        wsClose(ws)
      }, IDLE_TIMEOUT_MS)

      function resetIdleTimer() {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          wsSend(ws, JSON.stringify({ type: 'status', message: 'Sesión cerrada por inactividad (30 min)' }))
          try { stream.end() } catch {}
          try { sshClient.end() } catch {}
          wsClose(ws)
        }, IDLE_TIMEOUT_MS)
      }

      function cleanupSession() {
        clearTimeout(idleTimer)
        decrementWsCount(tokenRow.user_id)
        activeSessions.delete(sessionId)
      }

      activeSessions.set(sessionId, { sshClient, stream, ws })

      // SSH → Browser
      stream.on('data', (data) => {
        wsSend(ws, data)
      })

      stream.stderr.on('data', (data) => {
        wsSend(ws, data)
      })

      stream.on('close', () => {
        wsSend(ws, JSON.stringify({ type: 'exit', message: 'Sesion SSH cerrada' }))
        wsClose(ws)
        cleanupSession()
        auditLog(tokenRow.user_id, 'ssh_disconnect', {
          connectionId: tokenRow.connection_id,
          ip: request.ip || 'unknown',
        })
      })

      // Browser → SSH
      ws.on('message', (message) => {
        resetIdleTimer()
        // Convertir a string para inspeccionar
        const str = Buffer.isBuffer(message) ? message.toString('utf8') : String(message)

        // Detectar mensajes de control JSON (resize) — no reenviar al shell
        if (str.charAt(0) === '{') {
          try {
            const parsed = JSON.parse(str)
            if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
              stream.setWindow(parsed.rows, parsed.cols)
              return  // NO escribir al shell
            }
          } catch {
            // No es JSON válido, tratar como input
          }
        }

        // Input de teclado normal → escribir al shell SSH
        stream.write(Buffer.isBuffer(message) ? message : str)
      })

      ws.on('close', () => {
        try { stream.end() } catch {}
        try { sshClient.end() } catch {}
        cleanupSession()
      })

      ws.on('error', () => {
        try { stream.end() } catch {}
        try { sshClient.end() } catch {}
        cleanupSession()
      })
    })
  })

  sshClient.on('error', (err) => {
    decrementWsCount(tokenRow.user_id)
    wsSend(ws, JSON.stringify({ type: 'error', message: `SSH Error: ${err.message}` }))
    wsClose(ws)
    activeSessions.delete(sessionId)
    auditLog(tokenRow.user_id, 'ssh_error', {
      connectionId: tokenRow.connection_id,
      path: err.message,
      ip: request.ip || 'unknown',
    })
  })

  // Auto-inject user's default SSH key if connection has no explicit key or password
  if (!conn.private_key && !conn.password) {
    const defaultKey = db.prepare(
      "SELECT private_key FROM ssh_keys WHERE user_id = ? AND name = 'default'"
    ).get(tokenRow.user_id)
    if (defaultKey) {
      conn.private_key = decrypt(defaultKey.private_key)
    }
  }

  // Conectar SSH
  const sshOpts = {
    host:         conn.host,
    port:         conn.port || 22,
    username:     conn.username,
    readyTimeout: 20000,
  }

  if (conn.private_key) {
    sshOpts.privateKey = conn.private_key
    if (conn.passphrase) sshOpts.passphrase = conn.passphrase
  } else {
    sshOpts.password = conn.password
  }

  sshClient.connect(sshOpts)
}
