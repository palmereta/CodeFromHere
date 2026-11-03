// Persistent terminal sessions.
//
// A session lives on the server independently of any browser tab: closing or
// reloading the UI only detaches it. Output is kept in a ring buffer with
// absolute offsets, so a reconnecting client receives exactly what it missed.
// Sessions without clients are reaped after config.terminalDetachMinutes.
// For SSH sites with `use_tmux`, the remote side runs inside tmux, so even a
// server restart can be recovered by re-attaching to the same tmux session.
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import pty from 'node-pty'
import { config } from '../config.js'
import { getDb } from '../db/database.js'
import { auditLog } from '../security/audit.js'
import { RingBuffer } from './ringBuffer.js'
import { TelnetClient } from './telnet.js'
import { connectSsh, loadConnection } from '../services/sshConnect.js'
import { AGENTS, buildAgentCommand, composePrompt, resolveWorkspace, newAgentSessionId, posixQuote, psQuote, tomlString } from './agents.js'

const sessions = new Map()
const EXITED_RETENTION_MS = 2 * 60_000

class TermSession extends EventEmitter {
  constructor(userId, opts) {
    super()
    this.id = nanoid(16)
    this.userId = userId
    this.kind = opts.kind
    this.connectionId = opts.connectionId || null
    this.title = opts.title || ''
    this.cwd = opts.cwd || null
    this.agent = opts.agent || 'shell'
    this.agentSessionId = opts.agentSessionId || null
    this.tmuxName = opts.tmuxName || null
    this.cols = opts.cols || 120
    this.rows = opts.rows || 32
    this.createdAt = Date.now()
    this.lastActivity = Date.now()
    this.status = 'starting'
    this.exitCode = null
    this.error = null
    this.buffer = new RingBuffer(config.terminalScrollbackBytes)
    this.clients = new Set()
    this.backend = null
    this.tempFiles = []
    this.reapTimer = null
  }

  info() {
    return {
      id: this.id, kind: this.kind, connectionId: this.connectionId, title: this.title, cwd: this.cwd,
      agent: this.agent, agentSessionId: this.agentSessionId, tmuxName: this.tmuxName,
      cols: this.cols, rows: this.rows, status: this.status, exitCode: this.exitCode, error: this.error,
      createdAt: this.createdAt, lastActivity: this.lastActivity, attached: this.clients.size,
    }
  }

  output(buf) {
    this.lastActivity = Date.now()
    this.buffer.push(buf)
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(buf, { binary: true })
  }

  control(msg) {
    const text = JSON.stringify(msg)
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(text)
  }

  write(data) {
    if (this.status !== 'running') return
    this.lastActivity = Date.now()
    this.backend?.write(data)
  }

  resize(cols, rows) {
    cols = Math.max(2, Math.min(1000, cols | 0)); rows = Math.max(1, Math.min(500, rows | 0))
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols; this.rows = rows
    try { this.backend?.resize(cols, rows) } catch {}
  }

  /** Forces full-screen apps (agents, vim, htop) to repaint after a re-attach. */
  nudge() {
    if (this.status !== 'running') return
    try {
      this.backend?.resize(this.cols - 1, this.rows)
      setTimeout(() => { try { this.backend?.resize(this.cols, this.rows) } catch {} }, 60)
    } catch {}
  }

  attach(ws, since) {
    clearTimeout(this.reapTimer)
    this.clients.add(ws)
    const replay = this.buffer.since(Number.isFinite(since) ? since : 0)
    ws.send(JSON.stringify({ t: 'hello', session: this.info(), from: replay.from, truncated: replay.truncated }))
    if (replay.data.length) ws.send(replay.data, { binary: true })
    if (this.status === 'exited' || this.status === 'error') {
      ws.send(JSON.stringify({ t: 'exit', code: this.exitCode, error: this.error }))
    } else if (since === undefined || replay.truncated) {
      this.nudge()
    }
  }

  detach(ws) {
    this.clients.delete(ws)
    if (this.clients.size === 0) this.scheduleReap()
  }

  scheduleReap() {
    clearTimeout(this.reapTimer)
    const ms = (this.status === 'running' || this.status === 'starting')
      ? config.terminalDetachMinutes * 60_000 : EXITED_RETENTION_MS
    this.reapTimer = setTimeout(() => this.kill('detached-timeout'), ms)
    this.reapTimer.unref?.()
  }

  markExited(code, error = null) {
    if (this.status === 'exited' || this.status === 'error') return
    this.status = error ? 'error' : 'exited'
    this.exitCode = code ?? null
    this.error = error
    this.control({ t: 'exit', code: this.exitCode, error })
    this.cleanupTemp()
    auditLog(this.userId, 'terminal_closed', { connectionId: this.connectionId, kind: this.kind, session: this.id, code })
    if (this.clients.size === 0) this.scheduleReap()
  }

  kill(reason = 'killed') {
    clearTimeout(this.reapTimer)
    try { this.backend?.kill() } catch {}
    this.markExited(this.exitCode, this.status === 'running' ? null : this.error)
    for (const ws of this.clients) { try { ws.close(1000, reason) } catch {} }
    this.clients.clear()
    this.cleanupTemp()
    sessions.delete(this.id)
  }

  cleanupTemp() {
    for (const f of this.tempFiles.splice(0)) { try { f.local ? unlinkSync(f.path) : f.remove?.() } catch {} }
  }
}

// --- Backends ---------------------------------------------------------------

function defaultShell() {
  if (process.platform === 'win32') return { file: process.env.COMSPEC?.includes('pwsh') ? 'pwsh.exe' : 'powershell.exe', args: ['-NoLogo'], kind: 'powershell' }
  const file = process.env.SHELL || (existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash')
  return { file, args: ['-l'], kind: 'posix' }
}

function termEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  // Never leak the server's own secrets into user shells.
  for (const k of ['ENCRYPTION_KEY', 'SESSION_SECRET', 'CFH_DESKTOP_TOKEN']) delete env[k]
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'CodeFromHere'
  env.TERM_PROGRAM_VERSION = process.env.npm_package_version || '2'
  return env
}

function promptDir() {
  const dir = join(config.dataDir, 'prompts')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** Prepares prompt files for an agent launch and returns the command to type. */
async function agentLaunch(session, { shellKind, writeRemote, resume, extraArgs }) {
  const ws = resolveWorkspace(session.userId, session.connectionId, session.cwd)
  const prompt = composePrompt(session.userId, ws)
  let promptFile = null, tomlFile = null
  if (prompt) {
    const name = `${session.id}.md`
    if (writeRemote) {
      promptFile = await writeRemote(name, prompt)
      if (session.agent === 'codex') tomlFile = await writeRemote(`${session.id}.toml`, tomlString(prompt))
    } else {
      promptFile = join(promptDir(), name)
      writeFileSync(promptFile, prompt, { mode: 0o600 })
      session.tempFiles.push({ local: true, path: promptFile })
      if (session.agent === 'codex') {
        tomlFile = join(promptDir(), `${session.id}.toml`)
        writeFileSync(tomlFile, tomlString(prompt), { mode: 0o600 })
        session.tempFiles.push({ local: true, path: tomlFile })
      }
    }
  }
  if (!resume && !session.agentSessionId) session.agentSessionId = newAgentSessionId(session.agent)
  return {
    command: buildAgentCommand({
      agent: session.agent, shell: shellKind, promptFile, tomlFile, resume,
      sessionId: resume ? null : session.agentSessionId,
      extraArgs: extraArgs ?? ws?.agent_args,
    }),
    workspace: ws,
  }
}

async function startLocal(session, opts) {
  if (!config.allowLocalShell) throw Object.assign(new Error('Local shell is disabled on this server'), { statusCode: 403 })
  const shell = defaultShell()
  let cwd = session.cwd || config.home
  try { if (!statSync(cwd).isDirectory()) cwd = config.home } catch { cwd = config.home }
  session.cwd = cwd
  const p = pty.spawn(shell.file, shell.args, {
    name: 'xterm-256color', cols: session.cols, rows: session.rows, cwd, env: termEnv(), encoding: null,
    ...(process.platform === 'win32' ? { useConpty: true } : {}),
  })
  session.backend = {
    write: (d) => p.write(typeof d === 'string' ? d : d.toString('utf8')),
    resize: (c, r) => p.resize(c, r),
    kill: () => p.kill(),
  }
  p.onData((d) => session.output(Buffer.isBuffer(d) ? d : Buffer.from(d)))
  p.onExit(({ exitCode }) => session.markExited(exitCode))
  session.status = 'running'
  session.title ||= session.agent !== 'shell' ? AGENTS[session.agent].label : shell.file.split(/[\\/]/).pop()

  if (session.agent !== 'shell') {
    const { command } = await agentLaunch(session, { shellKind: shell.kind, resume: opts.resume, extraArgs: opts.agentArgs })
    // Leading space keeps it out of shell history when HISTCONTROL=ignorespace.
    if (command) p.write(' ' + command + '\r')
  } else if (opts.command) {
    p.write(opts.command + '\r')
  }
}

async function startSsh(session, opts) {
  const conn = loadConnection(session.userId, session.connectionId)
  if (!['ssh', 'sftp', 'scp'].includes(conn.type)) throw new Error('This site does not support SSH terminals')
  const client = await connectSsh(conn, session.userId)
  const stream = await new Promise((res, rej) => client.shell(
    { term: 'xterm-256color', cols: session.cols, rows: session.rows },
    { env: { COLORTERM: 'truecolor', TERM_PROGRAM: 'CodeFromHere' } },
    (e, s) => e ? rej(e) : res(s)))
  session.backend = {
    write: (d) => stream.write(d),
    resize: (c, r) => stream.setWindow(r, c, 0, 0),
    kill: () => { try { stream.end() } catch {} client.end() },
  }
  stream.on('data', (d) => session.output(d))
  stream.stderr?.on('data', (d) => session.output(d))
  stream.on('close', (code) => { session.markExited(typeof code === 'number' ? code : null); client.end() })
  client.on('close', () => session.markExited(session.exitCode))
  client.on('error', (e) => session.markExited(null, e.message))
  session.status = 'running'
  session.title ||= conn.name
  session.cwd ||= conn.root_path && conn.root_path !== '/' ? conn.root_path : null
  getDb().prepare("UPDATE connections SET last_connected = datetime('now') WHERE id = ?").run(conn.id)

  const lines = []
  if (session.cwd) lines.push(`cd ${posixQuote(session.cwd)}`)
  if (conn.startup_command && !opts.resume) lines.push(conn.startup_command)

  let agentCmd = null
  if (session.agent !== 'shell') {
    const writeRemote = (name, content) => new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err)
        const dir = '.cache/codefromhere/prompts'
        sftp.mkdir('.cache', () => sftp.mkdir('.cache/codefromhere', () => sftp.mkdir(dir, () => {
          const path = `${dir}/${name}`
          sftp.writeFile(path, content, { mode: 0o600 }, (e) => {
            if (e) return reject(e)
            session.tempFiles.push({ remove: () => client.sftp((_, s) => s?.unlink(path, () => {})) })
            sftp.realpath(path, (e2, abs) => resolve(e2 ? path : abs))
          })
        })))
      })
    })
    agentCmd = (await agentLaunch(session, { shellKind: 'posix', writeRemote, resume: opts.resume, extraArgs: opts.agentArgs })).command
  } else if (opts.command) {
    agentCmd = opts.command
  }

  if (conn.use_tmux || opts.tmux) {
    session.tmuxName ||= `cfh-${session.id.slice(0, 8)}`
    const t = posixQuote(session.tmuxName)
    const create = agentCmd
      ? `tmux new-session -d -s ${t} && tmux send-keys -t ${t} ${posixQuote(agentCmd)} Enter && exec tmux attach -t ${t}`
      : `exec tmux new-session -s ${t}`
    lines.push(`if command -v tmux >/dev/null 2>&1; then tmux has-session -t ${t} 2>/dev/null && exec tmux attach -t ${t} || { ${create}; }; fi`)
    if (agentCmd) lines.push(agentCmd) // reached only when tmux is missing
  } else if (agentCmd) {
    lines.push(agentCmd)
  }
  for (const l of lines) stream.write(' ' + l + '\n')
}

async function startTelnet(session) {
  const conn = loadConnection(session.userId, session.connectionId)
  if (conn.type !== 'telnet') throw new Error('Not a Telnet site')
  const t = new TelnetClient({ host: conn.host, port: conn.port || 23, cols: session.cols, rows: session.rows })
  await new Promise((res, rej) => { t.once('ready', res); t.once('error', rej) })
  session.backend = { write: (d) => t.write(d), resize: (c, r) => t.resize(c, r), kill: () => t.end() }
  t.on('data', (d) => session.output(d))
  t.on('close', () => session.markExited(0))
  t.on('error', (e) => session.markExited(null, e.message))
  session.status = 'running'
  session.title ||= conn.name
  getDb().prepare("UPDATE connections SET last_connected = datetime('now') WHERE id = ?").run(conn.id)
}

// --- Public API -------------------------------------------------------------

/**
 * @param {number} userId
 * @param {{kind:'local'|'ssh'|'telnet', connectionId?:number, cwd?:string, cols?:number, rows?:number,
 *          agent?:string, agentArgs?:string, resume?:{id?:string,last?:boolean}, agentSessionId?:string,
 *          tmux?:boolean, tmuxName?:string, title?:string, command?:string}} opts
 */
export async function createSession(userId, opts) {
  const mine = [...sessions.values()].filter(s => s.userId === userId && s.status !== 'exited')
  if (mine.length >= config.maxTerminalsPerUser) {
    throw Object.assign(new Error('Too many open terminals'), { statusCode: 429 })
  }
  if (opts.agent && !AGENTS[opts.agent]) throw Object.assign(new Error('Unknown agent'), { statusCode: 400 })
  const session = new TermSession(userId, opts)
  sessions.set(session.id, session)
  try {
    if (opts.kind === 'local') await startLocal(session, opts)
    else if (opts.kind === 'ssh') await startSsh(session, opts)
    else if (opts.kind === 'telnet') await startTelnet(session, opts)
    else throw Object.assign(new Error('Unknown terminal kind'), { statusCode: 400 })
  } catch (err) {
    sessions.delete(session.id)
    session.cleanupTemp()
    throw err
  }
  session.scheduleReap() // no client yet; the UI attaches right away
  auditLog(userId, 'terminal_opened', { connectionId: session.connectionId, kind: session.kind, agent: session.agent, session: session.id })
  return session
}

export const getSession = (id, userId) => {
  const s = sessions.get(id)
  return s && s.userId === userId ? s : null
}

export const listSessions = (userId) => [...sessions.values()].filter(s => s.userId === userId).map(s => s.info())

export function killAll() { for (const s of [...sessions.values()]) s.kill('server-shutdown') }
