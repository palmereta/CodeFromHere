// Lists previous AI agent conversations on this machine so they can be
// resumed from the UI. Reads only the head of each transcript file.
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

const HEAD_BYTES = 256 * 1024

async function head(file, bytes = HEAD_BYTES) {
  const fh = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead).toString('utf8').split('\n')
  } finally { await fh.close() }
}

const parse = (line) => { try { return JSON.parse(line) } catch { return null } }
const clip = (s, n = 140) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s)
const textOf = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(c => c.text || '').join(' ')
  return ''
}
// Skip injected context blocks (<environment_context>, <command-name>, …).
const isNoise = (t) => !t || /^\s*</.test(t) || /^Caveat:/i.test(t)

async function claudeSessions(cwd) {
  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  const dirs = cwd ? [cwd.replace(/[^a-zA-Z0-9]/g, '-')] : await fs.readdir(root).catch(() => [])
  const out = []
  for (const d of dirs) {
    const dir = join(root, d)
    const files = (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('.jsonl'))
    for (const f of files) {
      const file = join(dir, f)
      const st = await fs.stat(file).catch(() => null)
      if (!st || st.size < 200) continue
      out.push({ file, mtime: st.mtimeMs, size: st.size, id: f.replace(/\.jsonl$/, '') })
    }
  }
  out.sort((a, b) => b.mtime - a.mtime)
  const result = []
  for (const s of out.slice(0, 60)) {
    let title = null, sessionCwd = null, summary = null
    for (const line of await head(s.file)) {
      const o = parse(line)
      if (!o) continue
      sessionCwd ||= o.cwd || null
      if (o.type === 'summary' && o.summary) summary = o.summary
      if (o.type === 'user' && !title) { const t = textOf(o.message?.content); if (!isNoise(t)) title = t }
      if (title && sessionCwd) break
    }
    if (!title && !summary) continue
    if (cwd && sessionCwd && sessionCwd !== cwd) continue
    result.push({ agent: 'claude', id: s.id, cwd: sessionCwd, title: clip(summary || title), updatedAt: s.mtime, size: s.size })
  }
  return result
}

async function codexSessions(cwd) {
  const root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
  const files = []
  // sessions/YYYY/MM/DD/rollout-*.jsonl — walk newest first, stop early.
  const years = (await fs.readdir(root).catch(() => [])).sort().reverse()
  outer: for (const y of years) {
    for (const m of (await fs.readdir(join(root, y)).catch(() => [])).sort().reverse()) {
      for (const d of (await fs.readdir(join(root, y, m)).catch(() => [])).sort().reverse()) {
        for (const f of (await fs.readdir(join(root, y, m, d)).catch(() => [])).filter(f => f.endsWith('.jsonl')).sort().reverse()) {
          files.push(join(root, y, m, d, f))
          if (files.length >= 300) break outer
        }
      }
    }
  }
  const result = []
  for (const file of files) {
    let id = null, sessionCwd = null, title = null
    for (const line of await head(file, 128 * 1024)) {
      const o = parse(line)
      if (!o) continue
      if (o.type === 'session_meta') { id = o.payload?.id; sessionCwd = o.payload?.cwd }
      if (o.type === 'response_item' && o.payload?.role === 'user' && !title) {
        const t = textOf(o.payload.content?.map?.(c => ({ text: c.text })) ?? o.payload.content)
        if (!isNoise(t)) title = t
      }
      if (id && title) break
    }
    if (!id || (cwd && sessionCwd !== cwd)) continue
    const st = await fs.stat(file).catch(() => null)
    result.push({ agent: 'codex', id, cwd: sessionCwd, title: clip(title || '(no prompt)'), updatedAt: st?.mtimeMs ?? null, size: st?.size ?? 0 })
    if (result.length >= 60) break
  }
  return result
}

function opencodeSessions(cwd) {
  return new Promise((resolve) => {
    execFile('opencode', ['session', 'list', '--format', 'json', '-n', '60'], { cwd: cwd || homedir(), timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([])
      try {
        const list = JSON.parse(stdout)
        resolve((Array.isArray(list) ? list : []).map(s => ({
          agent: 'opencode', id: s.id, cwd: s.directory || cwd || null, title: clip(s.title || s.id),
          updatedAt: s.time?.updated ?? s.updated ?? null, size: 0,
        })))
      } catch { resolve([]) }
    })
  })
}

export async function listAgentHistory({ agent, cwd } = {}) {
  const tasks = []
  if (!agent || agent === 'claude') tasks.push(claudeSessions(cwd))
  if (!agent || agent === 'codex') tasks.push(codexSessions(cwd))
  if (!agent || agent === 'opencode') tasks.push(opencodeSessions(cwd))
  const all = (await Promise.all(tasks.map(t => t.catch(() => [])))).flat()
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}
