import { getDb } from '../db/database.js'
import { decryptConnection, decrypt } from '../services/crypto.js'
import { createAdapter } from '../services/filesystem.js'
import { extname } from 'path'
import { auditLog } from '../middleware/auth.js'

// Sanitización obligatoria: eliminar '..' de todos los paths + reject null bytes
function sanitizePath(p) {
  if (typeof p !== 'string') return '/'
  // Reject null bytes — common injection vector
  if (p.includes('\0')) throw new Error('Invalid path: null bytes not allowed')
  const parts = p.split('/').filter(seg => seg !== '..' && seg !== '.')
  return '/' + parts.filter(Boolean).join('/')
}

// Validate connection_id is a positive integer
function validateConnectionId(id) {
  const num = Number(id)
  if (!Number.isInteger(num) || num < 1) {
    throw new Error('connection_id inválido')
  }
  return num
}

// Detectar si un buffer es binario
function isBinary(buffer) {
  for (let i = 0; i < Math.min(buffer.length, 8000); i++) {
    if (buffer[i] === 0) return true
  }
  return false
}

// Mapear extensión a lenguaje Monaco (IDs válidos de Monaco Editor)
// Lista completa: https://github.com/microsoft/monaco-editor/tree/main/src/basic-languages
function detectLanguage(filename) {
  // Archivos especiales por nombre exacto
  const basename = filename.split('/').pop().toLowerCase()
  const nameMap = {
    'dockerfile': 'dockerfile',
    'makefile': 'plaintext',
    'gnumakefile': 'plaintext',
    '.gitignore': 'plaintext',
    '.dockerignore': 'plaintext',
    '.editorconfig': 'ini',
    '.env': 'ini',
    '.env.local': 'ini',
    '.env.example': 'ini',
    '.htaccess': 'plaintext',
  }
  if (nameMap[basename]) return nameMap[basename]

  const ext = extname(filename).toLowerCase().slice(1)
  const map = {
    // JavaScript / TypeScript
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    // Web
    html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less',
    json: 'json', jsonc: 'json', json5: 'json',
    // Markup
    md: 'markdown', mdx: 'markdown',
    xml: 'xml', svg: 'xml', xsl: 'xml', xslt: 'xml',
    yaml: 'yaml', yml: 'yaml',
    // Backend
    py: 'python', pyw: 'python',
    rb: 'ruby',
    php: 'php', phtml: 'php',
    java: 'java',
    go: 'go',
    rs: 'rust',
    cs: 'csharp',
    swift: 'swift',
    kt: 'kotlin', kts: 'kotlin',
    scala: 'scala',
    clj: 'clojure', cljs: 'clojure', cljc: 'clojure',
    dart: 'dart',
    lua: 'lua',
    r: 'r', R: 'r',
    pl: 'perl', pm: 'perl',
    // C/C++ -> Monaco usa 'cpp' para ambos
    c: 'cpp', h: 'cpp',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
    hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
    // Objective-C
    m: 'objective-c', mm: 'objective-c',
    // Shell
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    // Database
    sql: 'sql', mysql: 'mysql', pgsql: 'pgsql',
    // Config
    ini: 'ini', conf: 'ini', cfg: 'ini',
    env: 'ini',
    toml: 'ini',
    // Otros
    bat: 'bat', cmd: 'bat',
    ps1: 'powershell', psm1: 'powershell',
    graphql: 'graphql', gql: 'graphql',
    proto: 'protobuf',
    tf: 'hcl', hcl: 'hcl',
    // Frontend frameworks (syntax resaltado como HTML)
    vue: 'html',
    svelte: 'html',
  }
  return map[ext] || 'plaintext'
}

const MAX_EDITOR_SIZE = 5 * 1024 * 1024 // 5MB

// Helper: obtener adapter conectado para una conexión del usuario
// Si la conexión es SFTP y no tiene private_key ni password, inyecta la clave default del usuario
async function getConnectedAdapter(request, connectionId) {
  const db = getDb()
  const connRow = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
    .get(connectionId, request.user.id)
  if (!connRow) throw new Error('Conexión no encontrada')

  const conn = decryptConnection(connRow)

  // Auto-inject user's default SSH key for SFTP connections without explicit credentials
  if (conn.type === 'sftp' && !conn.private_key && !conn.password) {
    const defaultKey = db.prepare(
      "SELECT private_key FROM ssh_keys WHERE user_id = ? AND name = 'default'"
    ).get(request.user.id)
    if (defaultKey) {
      conn.private_key = decrypt(defaultKey.private_key)
    }
  }

  const adapter = createAdapter(conn)
  await adapter.connect()
  return { adapter, conn }
}

export default async function filesRoutes(fastify) {
  // GET /api/files/list
  fastify.get('/list', async (request, reply) => {
    const { connection_id, path } = request.query
    if (!connection_id) return reply.code(400).send({ error: 'connection_id requerido' })

    let connId
    try { connId = validateConnectionId(connection_id) } catch {
      return reply.code(400).send({ error: 'connection_id inválido' })
    }

    const safePath = sanitizePath(path || '/')
    const { adapter } = await getConnectedAdapter(request, connId)

    try {
      const items = await adapter.list(safePath)
      return items
    } finally {
      await adapter.disconnect()
    }
  })

  // GET /api/files/read
  fastify.get('/read', async (request, reply) => {
    const { connection_id, path } = request.query
    if (!connection_id || !path) return reply.code(400).send({ error: 'connection_id y path requeridos' })

    let connId
    try { connId = validateConnectionId(connection_id) } catch {
      return reply.code(400).send({ error: 'connection_id inválido' })
    }

    const safePath = sanitizePath(path)
    const { adapter } = await getConnectedAdapter(request, connId)

    try {
      const rawData = await adapter.read(safePath)
      const buffer = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData)

      if (buffer.length > MAX_EDITOR_SIZE) {
        return { binary: false, tooLarge: true, size: buffer.length, message: `Archivo muy grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Max: 5MB` }
      }
      if (isBinary(buffer)) {
        return { binary: true, size: buffer.length }
      }
      const content = buffer.toString('utf8')
      const language = detectLanguage(path)
      return { content, language, size: buffer.length, binary: false, tooLarge: false }
    } finally {
      await adapter.disconnect()
    }
  })

  // POST /api/files/write
  fastify.post('/write', async (request, reply) => {
    const { connection_id, path, content } = request.body || {}
    if (!connection_id || !path) return reply.code(400).send({ error: 'connection_id y path requeridos' })

    let connId
    try { connId = validateConnectionId(connection_id) } catch {
      return reply.code(400).send({ error: 'connection_id inválido' })
    }

    const safePath = sanitizePath(path)
    const { adapter } = await getConnectedAdapter(request, connId)

    try {
      await adapter.write(safePath, content || '')
      auditLog(request.user.id, 'file_write', { connectionId: connId, path: safePath, ip: request.clientIp })
      return { ok: true }
    } finally {
      await adapter.disconnect()
    }
  })

  // DELETE /api/files/delete
  fastify.delete('/delete', async (request, reply) => {
    const { connection_id, path, isDir } = request.body || {}
    if (!connection_id || !path) return reply.code(400).send({ error: 'connection_id y path requeridos' })

    let connId
    try { connId = validateConnectionId(connection_id) } catch {
      return reply.code(400).send({ error: 'connection_id inválido' })
    }

    const safePath = sanitizePath(path)
    const { adapter } = await getConnectedAdapter(request, connId)

    try {
      await adapter.delete(safePath, isDir)
      auditLog(request.user.id, 'file_delete', { connectionId: connId, path: safePath, ip: request.clientIp })
      return { ok: true }
    } finally {
      await adapter.disconnect()
    }
  })

  // POST /api/files/mkdir
  fastify.post('/mkdir', async (request, reply) => {
    const { connection_id, path } = request.body || {}
    if (!connection_id || !path) return reply.code(400).send({ error: 'connection_id y path requeridos' })

    let connId
    try { connId = validateConnectionId(connection_id) } catch {
      return reply.code(400).send({ error: 'connection_id inválido' })
    }

    const safePath = sanitizePath(path)
    const { adapter } = await getConnectedAdapter(request, connId)

    try {
      await adapter.mkdir(safePath)
      auditLog(request.user.id, 'file_mkdir', { connectionId: connId, path: safePath, ip: request.clientIp })
      return { ok: true }
    } finally {
      await adapter.disconnect()
    }
  })

  // POST /api/files/rename
  fastify.post('/rename', async (request, reply) => {
    const { connection_id, oldPath, newPath } = request.body || {}
    if (!connection_id || !oldPath || !newPath) return reply.code(400).send({ error: 'Faltan parámetros' })

    let connId
    try { connId = validateConnectionId(connection_id) } catch {
      return reply.code(400).send({ error: 'connection_id inválido' })
    }

    const safeOld = sanitizePath(oldPath)
    const safeNew = sanitizePath(newPath)
    const { adapter } = await getConnectedAdapter(request, connId)

    try {
      await adapter.rename(safeOld, safeNew)
      auditLog(request.user.id, 'file_rename', { connectionId: connId, path: `${safeOld} -> ${safeNew}`, ip: request.clientIp })
      return { ok: true }
    } finally {
      await adapter.disconnect()
    }
  })

  // GET /api/files/download
  fastify.get('/download', async (request, reply) => {
    const { connection_id, path } = request.query
    if (!connection_id || !path) return reply.code(400).send({ error: 'connection_id y path requeridos' })

    let connId
    try { connId = validateConnectionId(connection_id) } catch {
      return reply.code(400).send({ error: 'connection_id inválido' })
    }

    const safePath = sanitizePath(path)
    const { adapter } = await getConnectedAdapter(request, connId)

    try {
      const rawData = await adapter.read(safePath)
      const buffer = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData)
      const filename = safePath.split('/').pop()
      reply.header('Content-Disposition', `attachment; filename="${filename}"`)
      reply.header('Content-Type', 'application/octet-stream')
      reply.header('Content-Length', buffer.length)
      return reply.send(buffer)
    } finally {
      await adapter.disconnect()
    }
  })

  // POST /api/files/upload (multipart)
  fastify.post('/upload', async (request, reply) => {
    const parts = request.parts()
    let connectionId, uploadPath
    const files = []

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'connection_id') connectionId = part.value
        if (part.fieldname === 'path') uploadPath = part.value
      } else if (part.type === 'file') {
        const chunks = []
        for await (const chunk of part.file) chunks.push(chunk)
        files.push({ name: part.filename, data: Buffer.concat(chunks) })
      }
    }

    if (!connectionId) return reply.code(400).send({ error: 'connection_id requerido' })

    let connId
    try { connId = validateConnectionId(connectionId) } catch {
      return reply.code(400).send({ error: 'connection_id inválido' })
    }

    const basePath = sanitizePath(uploadPath || '/')
    const { adapter } = await getConnectedAdapter(request, connId)

    try {
      for (const file of files) {
        const filePath = basePath.replace(/\/$/, '') + '/' + file.name
        await adapter.write(filePath, file.data)
      }
      auditLog(request.user.id, 'file_upload', { connectionId: connId, path: basePath, ip: request.clientIp })
      return { ok: true, uploaded: files.length }
    } finally {
      await adapter.disconnect()
    }
  })

  // POST /api/files/chmod (solo SFTP)
  fastify.post('/chmod', async (request, reply) => {
    const { connection_id, path, mode } = request.body || {}
    if (!connection_id || !path || !mode) return reply.code(400).send({ error: 'Faltan parámetros' })

    let connId
    try { connId = validateConnectionId(connection_id) } catch {
      return reply.code(400).send({ error: 'connection_id inválido' })
    }

    const safePath = sanitizePath(path)
    const { adapter } = await getConnectedAdapter(request, connId)

    try {
      if (typeof adapter.chmod !== 'function') {
        return reply.code(400).send({ error: 'chmod solo disponible en conexiones SFTP' })
      }
      await adapter.chmod(safePath, parseInt(mode, 8))
      return { ok: true }
    } finally {
      await adapter.disconnect()
    }
  })

  // POST /api/files/copy (cross-host file/folder copy)
  fastify.post('/copy', async (request, reply) => {
    const { source_connection_id, source_path, dest_connection_id, dest_path, is_dir, cut } = request.body || {}
    if (!source_connection_id || !source_path || !dest_connection_id || !dest_path) {
      return reply.code(400).send({ error: 'source_connection_id, source_path, dest_connection_id y dest_path requeridos' })
    }

    let srcConnId, destConnId
    try { srcConnId = validateConnectionId(source_connection_id) } catch {
      return reply.code(400).send({ error: 'source_connection_id inválido' })
    }
    try { destConnId = validateConnectionId(dest_connection_id) } catch {
      return reply.code(400).send({ error: 'dest_connection_id inválido' })
    }

    const safeSrcPath = sanitizePath(source_path)
    const safeDestPath = sanitizePath(dest_path)

    // Verify both connections belong to the current user
    const db = getDb()
    const srcConn = db.prepare('SELECT id FROM connections WHERE id = ? AND user_id = ?').get(srcConnId, request.user.id)
    const destConn = db.prepare('SELECT id FROM connections WHERE id = ? AND user_id = ?').get(destConnId, request.user.id)
    if (!srcConn) return reply.code(404).send({ error: 'Conexión origen no encontrada' })
    if (!destConn) return reply.code(404).send({ error: 'Conexión destino no encontrada' })

    async function recursiveCopy(srcAdapter, destAdapter, srcPath, destPath) {
      let count = 0
      const items = await srcAdapter.list(srcPath)
      try { await destAdapter.mkdir(destPath) } catch {}
      for (const item of items) {
        const destItemPath = destPath.replace(/\/$/, '') + '/' + item.name
        if (item.isDir) {
          count += await recursiveCopy(srcAdapter, destAdapter, item.path, destItemPath)
        } else {
          const rawData = await srcAdapter.read(item.path)
          const buffer = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData)
          await destAdapter.write(destItemPath, buffer)
          count++
        }
      }
      return count
    }

    const { adapter: srcAdapter } = await getConnectedAdapter(request, srcConnId)
    const { adapter: destAdapter } = await getConnectedAdapter(request, destConnId)

    try {
      let filesCopied = 0

      if (is_dir) {
        filesCopied = await recursiveCopy(srcAdapter, destAdapter, safeSrcPath, safeDestPath)
      } else {
        const rawData = await srcAdapter.read(safeSrcPath)
        const buffer = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData)
        await destAdapter.write(safeDestPath, buffer)
        filesCopied = 1
      }

      // If cut mode, delete source after successful copy
      if (cut) {
        // Need a fresh adapter connection for source delete since we may have disconnected
        const { adapter: deleteAdapter } = await getConnectedAdapter(request, srcConnId)
        try {
          await deleteAdapter.delete(safeSrcPath, !!is_dir)
        } finally {
          await deleteAdapter.disconnect()
        }
      }

      auditLog(request.user.id, 'file_copy', {
        sourceConnectionId: srcConnId,
        destConnectionId: destConnId,
        sourcePath: safeSrcPath,
        destPath: safeDestPath,
        isDir: !!is_dir,
        cut: !!cut,
        filesCopied,
        ip: request.clientIp
      })

      return { ok: true, files_copied: filesCopied }
    } finally {
      await srcAdapter.disconnect()
      await destAdapter.disconnect()
    }
  })
}
