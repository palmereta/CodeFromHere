import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildAgentCommand, posixQuote, tomlString } from '../src/sessions/agents.js'

// Fake agents that print exactly what they received.
let bin, dir
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cfh-agents-'))
  bin = join(dir, 'bin'); mkdirSync(bin)
  for (const a of ['claude', 'codex', 'opencode']) {
    writeFileSync(join(bin, a), `#!/bin/sh\nfor x in "$@"; do printf '[%s]' "$x"; done\nprintf '\\nENV:%s\\n' "$OPENCODE_CONFIG_CONTENT"\n`)
    chmodSync(join(bin, a), 0o755)
  }
})
const run = (cmd) => execFileSync('/bin/sh', ['-c', cmd], { env: { PATH: `${bin}:/usr/bin:/bin` } }).toString()

const PROMPT = `It's a "billing" service.\nRun \`npm test\` & $HOME stays literal.\n`

describe('buildAgentCommand', () => {
  it('claude: new session id + prompt file', () => {
    const f = join(dir, 'p.md'); writeFileSync(f, PROMPT)
    const out = run(buildAgentCommand({ agent: 'claude', promptFile: f, sessionId: 'abc-123' }))
    expect(out).toContain(`[--session-id][abc-123][--append-system-prompt-file][${f}]`)
  })

  it('claude: resume by id wins over new session id', () => {
    const out = run(buildAgentCommand({ agent: 'claude', resume: { id: 'xyz' }, sessionId: 'ignored' }))
    expect(out).toContain('[--resume][xyz]')
    expect(out).not.toContain('ignored')
  })

  it('codex: developer_instructions read from a TOML string file, shell-safe', () => {
    const f = join(dir, 'p.toml'); writeFileSync(f, tomlString(PROMPT))
    const out = run(buildAgentCommand({ agent: 'codex', tomlFile: f, resume: { last: true } }))
    expect(out.startsWith('[resume][--last][-c][developer_instructions=')).toBe(true)
    const value = out.match(/\[developer_instructions=(.*)\]\nENV/s)[1]
    expect(JSON.parse(value)).toBe(PROMPT) // TOML basic string == JSON string here
  })

  it('opencode: instructions via OPENCODE_CONFIG_CONTENT', () => {
    const out = run(buildAgentCommand({ agent: 'opencode', promptFile: "/tmp/it's here.md", resume: { id: 'ses_1' } }))
    expect(out).toContain('[--session][ses_1]')
    expect(JSON.parse(out.split('ENV:')[1])).toEqual({ instructions: ["/tmp/it's here.md"] })
  })

  it('posixQuote survives hostile input', () => {
    const evil = `'; rm -rf / #$(whoami)\``
    expect(run(`printf %s ${posixQuote(evil)}`)).toBe(evil)
  })

  it('powershell quoting doubles single quotes', () => {
    const cmd = buildAgentCommand({ agent: 'claude', shell: 'powershell', promptFile: "C:\\it's\\p.md" })
    expect(cmd).toBe("& claude --append-system-prompt-file 'C:\\it''s\\p.md'")
  })
})
