// Shared SSH connection factory for terminals, SFTP and SCP.
// - Host keys are pinned per user (TOFU): unknown → HOSTKEY_UNKNOWN, changed →
//   HOSTKEY_MISMATCH. The UI asks the user and calls /trust-host. This closes
//   the MITM hole of v1, which accepted any key (OWASP ASVS 9.2).
// - Supports password, stored key, the user's default key, ssh-agent (desktop)
//   and one or more jump hosts.
import { Client } from 'ssh2'
import { createHash } from 'node:crypto'
import { getDb } from '../db/database.js'
import { decrypt, decryptConnection } from '../security/crypto.js'
import { config } from '../config.js'

export class HostKeyError extends Error {
  constructor(code, info) {
    super(code === 'HOSTKEY_MISMATCH'
      ? `Host key for ${info.host}:${info.port} CHANGED. Possible man-in-the-middle attack.`
      : `Unknown host key for ${info.host}:${info.port}`)
    this.code = code
    this.info = info
  }
}

export function fingerprintOf(rawKey) {
  return 'SHA256:' + createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '')
}

function keyType(raw) {
  try { const len = raw.readUInt32BE(0); return raw.subarray(4, 4 + len).toString('ascii') } catch { return 'unknown' }
}

export function trustHost(userId, host, port, fingerprint, type = null) {
  getDb().prepare(`INSERT INTO known_hosts (user_id, host, port, key_type, fingerprint) VALUES (?,?,?,?,?)
                   ON CONFLICT(user_id, host, port) DO UPDATE SET fingerprint = excluded.fingerprint,
                   key_type = excluded.key_type, created_at = datetime('now')`).run(userId, host, port, type, fingerprint)
}

function buildAuth(conn, userId) {
  const opts = { username: conn.username }
  if (conn.password) opts.password = conn.password
  let key = conn.private_key
  if (!key && conn.ssh_key_id) {
    key = decrypt(getDb().prepare('SELECT private_key FROM ssh_keys WHERE id = ? AND user_id = ?').get(conn.ssh_key_id, userId)?.private_key)
  }
  if (!key && !conn.password && !conn.use_agent) {
    key = decrypt(getDb().prepare("SELECT private_key FROM ssh_keys WHERE user_id = ? AND name = 'default'").get(userId)?.private_key)
  }
  if (key) { opts.privateKey = key; if (conn.passphrase) opts.passphrase = conn.passphrase }
  // ssh-agent only makes sense when the server runs on the user's machine.
  if (conn.use_agent && config.mode === 'desktop') {
    opts.agent = process.platform === 'win32' ? 'pageant' : process.env.SSH_AUTH_SOCK
  }
  if (conn.password) opts.tryKeyboard = true
  return opts
}

/** Loads a connection row owned by userId and returns it decrypted. */
export function loadConnection(userId, connectionId) {
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').get(connectionId, userId)
  if (!row) { const e = new Error('Connection not found'); e.statusCode = 404; throw e }
  return decryptConnection(row)
}

/**
 * Opens an authenticated ssh2 Client. Resolves when ready.
 * @param {object} conn decrypted connection row
 * @param {number} userId
 * @param {number} depth guard against jump-host loops
 */
export function connectSsh(conn, userId, depth = 0) {
  return new Promise(async (resolve, reject) => {
    if (depth > 4) return reject(new Error('Too many jump hosts'))
    const host = conn.host
    const port = conn.port || 22
    let hostKeyError = null
    let sock
    let jumpClient
    try {
      if (conn.jump_id) {
        jumpClient = await connectSsh(loadConnection(userId, conn.jump_id), userId, depth + 1)
        sock = await new Promise((res, rej) => jumpClient.forwardOut('127.0.0.1', 0, host, port, (e, s) => e ? rej(e) : res(s)))
      }
    } catch (e) { jumpClient?.end(); return reject(e) }

    const client = new Client()
    client.on('ready', () => {
      if (jumpClient) client.on('close', () => jumpClient.end())
      resolve(client)
    })
    client.on('error', (err) => { jumpClient?.end(); reject(hostKeyError || err) })
    client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
      // Answer password prompts with the stored password (servers that only
      // allow keyboard-interactive). Real 2FA prompts are not answered.
      finish(prompts.map(p => /pass/i.test(p.prompt) ? (conn.password || '') : ''))
    })
    client.connect({
      host, port, sock,
      readyTimeout: 20000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 4,
      ...buildAuth(conn, userId),
      hostVerifier: (rawKey) => {
        const fingerprint = fingerprintOf(rawKey)
        const known = getDb().prepare('SELECT fingerprint FROM known_hosts WHERE user_id = ? AND host = ? AND port = ?').get(userId, host, port)
        if (known?.fingerprint === fingerprint) return true
        hostKeyError = new HostKeyError(known ? 'HOSTKEY_MISMATCH' : 'HOSTKEY_UNKNOWN',
          { host, port, fingerprint, keyType: keyType(rawKey), connectionId: conn.id, expected: known?.fingerprint })
        return false
      },
    })
  })
}

/** Maps a connection error to an HTTP/WS friendly payload. */
export function errorPayload(err) {
  if (err instanceof HostKeyError) return { error: err.message, code: err.code, hostKey: err.info }
  return { error: err.message || String(err) }
}
