// AI coding agents (Claude Code, Codex, OpenCode): how to launch them, how to
// inject a per-folder system prompt and how to resume a previous conversation.
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/database.js'

export const AGENTS = {
  shell:    { label: 'Shell' },
  claude:   { label: 'Claude Code', bin: 'claude' },
  codex:    { label: 'Codex', bin: 'codex' },
  opencode: { label: 'OpenCode', bin: 'opencode' },
}

export const posixQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
export const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

/** TOML basic string; JSON escaping is a valid subset (JSON.stringify never emits "\/"). */
export const tomlString = (s) => JSON.stringify(String(s))

/**
 * Finds the workspace that applies to `path`: exact match first, then the
 * deepest ancestor marked `inherit`.
 */
export function resolveWorkspace(userId, connectionId, path) {
  if (!path) return null
  const rows = getDb().prepare('SELECT * FROM workspaces WHERE user_id = ? AND IFNULL(connection_id, 0) = ?')
    .all(userId, connectionId || 0)
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  const target = norm(path)
  let best = null
  for (const ws of rows) {
    const base = norm(ws.path)
    const isExact = base === target
    const isAncestor = target.startsWith(base === '/' ? '/' : base + '/')
    if (isExact || (ws.inherit && isAncestor)) {
      if (!best || base.length > norm(best.path).length) best = ws
    }
  }
  return best
}

/** Composes the text injected as system prompt: global + workspace + saved context. */
export function composePrompt(userId, workspace) {
  let globalPrompt = ''
  try {
    const prefs = getDb().prepare('SELECT config_json FROM user_prefs WHERE user_id = ?').get(userId)
    globalPrompt = JSON.parse(prefs?.config_json || '{}')?.ai?.globalPrompt || ''
  } catch {}
  const parts = []
  if (globalPrompt.trim()) parts.push(globalPrompt.trim())
  if (workspace?.system_prompt?.trim()) parts.push(workspace.system_prompt.trim())
  if (workspace?.context?.trim()) parts.push('## Saved project context\n\n' + workspace.context.trim())
  return parts.join('\n\n')
}

/**
 * Builds the command line typed into the shell to start an agent.
 * @param {object} o
 * @param {'claude'|'codex'|'opencode'} o.agent
 * @param {'posix'|'powershell'} o.shell
 * @param {string|null} o.promptFile   file with the plain prompt (claude/opencode)
 * @param {string|null} o.tomlFile     file with the prompt as a TOML string (codex)
 * @param {{id?:string,last?:boolean}|null} o.resume
 * @param {string|null} o.sessionId    new conversation id to assign (claude)
 * @param {string} [o.extraArgs]       raw user-provided args, appended as-is
 */
export function buildAgentCommand({ agent, shell = 'posix', promptFile, tomlFile, resume, sessionId, extraArgs }) {
  const q = shell === 'powershell' ? psQuote : posixQuote
  const def = AGENTS[agent]
  if (!def?.bin) return null
  const args = []
  let prefix = ''

  if (agent === 'claude') {
    if (resume?.id) args.push('--resume', q(resume.id))
    else if (resume?.last) args.push('--continue')
    else if (sessionId) args.push('--session-id', q(sessionId))
    if (promptFile) args.push('--append-system-prompt-file', q(promptFile))
  } else if (agent === 'codex') {
    if (resume?.id) args.push('resume', q(resume.id))
    else if (resume?.last) args.push('resume', '--last')
    if (tomlFile) {
      args.push('-c', shell === 'powershell'
        ? `("developer_instructions=" + (Get-Content -Raw ${q(tomlFile)}))`
        : `"developer_instructions=$(cat ${q(tomlFile)})"`)
    }
  } else if (agent === 'opencode') {
    if (resume?.id) args.push('--session', q(resume.id))
    else if (resume?.last) args.push('--continue')
    if (promptFile) {
      const cfg = JSON.stringify({ instructions: [promptFile] })
      prefix = shell === 'powershell' ? `$env:OPENCODE_CONFIG_CONTENT=${q(cfg)}; ` : `OPENCODE_CONFIG_CONTENT=${q(cfg)} `
    }
  }
  if (extraArgs?.trim()) args.push(extraArgs.trim())
  const bin = shell === 'powershell' ? `& ${def.bin}` : def.bin
  return prefix + [bin, ...args].join(' ')
}

export const newAgentSessionId = (agent) => (agent === 'claude' ? randomUUID() : null)
