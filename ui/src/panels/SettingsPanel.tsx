import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { api, timeAgo } from '../api'
import { useStore } from '../store'
import { THEMES } from '../config/themes'
import { DEFAULT_CONFIG, diffConfig, mergeConfig } from '../config/defaults'
import { defaultKeys, detectModStyle, keyLabel } from '../config/keymap'
import { getCommands } from '../commands'
import { loadMonaco, defineThemes } from '../monaco'
import { askConfirm, askText } from '../dialogs/Prompt'

const SECTIONS = [
  ['appearance', 'Appearance'], ['terminal', 'Terminal'], ['ai', 'AI agents'], ['transfers', 'Transfers'],
  ['keys', 'Keyboard'], ['account', 'Account & security'], ['ssh', 'SSH keys & hosts'], ['admin', 'Administration'], ['json', 'Edit config (JSON)'],
] as const

function useCfg() {
  const config = useStore(s => s.config)
  const userConfig = useStore(s => s.userConfig)
  const set = (path: string, value: any) => {
    const next = structuredClone(mergeConfig(DEFAULT_CONFIG, userConfig))
    const keys = path.split('.')
    let o: any = next
    for (const k of keys.slice(0, -1)) o = o[k]
    o[keys.at(-1)!] = value
    useStore.getState().saveConfig(diffConfig(DEFAULT_CONFIG, next))
  }
  return { config, set }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}{hint && <span className="muted sm"> — {hint}</span>}</span>{children}</label>
}

function Appearance() {
  const { config, set } = useCfg()
  return (
    <>
      <h3>Theme</h3>
      <div className="theme-grid">
        {Object.entries(THEMES).map(([id, t]) => (
          <button key={id} className={`theme-card${config.theme === id ? ' on' : ''}`} onClick={() => set('theme', id)} style={{ background: t.background, color: t.foreground, borderColor: config.theme === id ? t.accent : t.border }}>
            <div className="theme-swatches">{t.ansi.slice(1, 7).map((c, i) => <span key={i} style={{ background: c }} />)}</div>
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      <div className="grid2">
        <Field label="Font family"><input className="input mono" value={config.fontFamily} onChange={e => set('fontFamily', e.target.value)} /></Field>
        <Field label="Font size"><input className="input" type="number" min={6} max={40} value={config.fontSize} onChange={e => set('fontSize', Number(e.target.value))} /></Field>
        <Field label="Line height"><input className="input" type="number" step={0.05} min={0.8} max={2} value={config.lineHeight} onChange={e => set('lineHeight', Number(e.target.value))} /></Field>
        <Field label="Letter spacing"><input className="input" type="number" step={0.5} value={config.letterSpacing} onChange={e => set('letterSpacing', Number(e.target.value))} /></Field>
        <Field label="Cursor">
          <select className="select" value={config.cursorStyle} onChange={e => set('cursorStyle', e.target.value)}>
            <option value="block">Block</option><option value="bar">Bar</option><option value="underline">Underline</option>
          </select>
        </Field>
        <Field label="Padding" hint="CSS, e.g. 10px 14px"><input className="input" value={config.padding} onChange={e => set('padding', e.target.value)} /></Field>
        <Field label="Background opacity" hint="desktop vibrancy"><input type="range" min={0.5} max={1} step={0.05} value={config.backgroundOpacity} onChange={e => set('backgroundOpacity', Number(e.target.value))} /></Field>
        <Field label="Minimum contrast ratio"><input className="input" type="number" min={1} max={21} step={0.5} value={config.minimumContrastRatio} onChange={e => set('minimumContrastRatio', Number(e.target.value))} /></Field>
      </div>
      <div className="checks">
        <label className="check"><input type="checkbox" checked={config.cursorBlink} onChange={e => set('cursorBlink', e.target.checked)} /> Blinking cursor</label>
        <label className="check"><input type="checkbox" checked={config.tabs.showIcons} onChange={e => set('tabs.showIcons', e.target.checked)} /> Icons in tabs</label>
        <label className="check"><input type="checkbox" checked={config.webgl} onChange={e => set('webgl', e.target.checked)} /> GPU rendering (WebGL)</label>
      </div>
      <p className="muted sm">Any color can be overridden in the JSON config under <code>colors</code> (background, foreground, cursor, accent, ansi…).</p>
    </>
  )
}

function TerminalSection() {
  const { config, set } = useCfg()
  return (
    <>
      <div className="grid2">
        <Field label="Scrollback lines"><input className="input" type="number" min={100} max={200000} value={config.scrollback} onChange={e => set('scrollback', Number(e.target.value))} /></Field>
        <Field label="Right click">
          <select className="select" value={config.rightClick} onChange={e => set('rightClick', e.target.value)}>
            <option value="menu">Context menu</option><option value="paste">Paste</option>
          </select>
        </Field>
        <Field label="Bell">
          <select className="select" value={config.bell} onChange={e => set('bell', e.target.value)}>
            <option value="visual">Visual</option><option value="sound">Sound</option><option value="none">None</option>
          </select>
        </Field>
        <Field label="New tab opens">
          <select className="select" value={config.newTab.agent} onChange={e => set('newTab.agent', e.target.value)}>
            <option value="shell">Shell</option><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="opencode">OpenCode</option>
          </select>
        </Field>
      </div>
      <div className="checks">
        <label className="check"><input type="checkbox" checked={config.copyOnSelect} onChange={e => set('copyOnSelect', e.target.checked)} /> Copy on select</label>
        <label className="check"><input type="checkbox" checked={config.macOptionIsMeta} onChange={e => set('macOptionIsMeta', e.target.checked)} /> Option key is Meta (macOS)</label>
        <label className="check"><input type="checkbox" checked={config.notifications.onBell} onChange={e => set('notifications.onBell', e.target.checked)} /> Desktop notification on bell / OSC 9 / OSC 777 in background tabs</label>
      </div>
    </>
  )
}

function AiSection() {
  const { config, set } = useCfg()
  const [draft, setDraft] = useState(config.ai.globalPrompt)
  return (
    <>
      <p className="muted">Claude Code, Codex and OpenCode run as regular terminal apps (true color, Kitty-style keys, OSC notifications). CodeFromHere adds per-folder system prompts, saved context, resumable sessions and "waiting for you" alerts.</p>
      <div className="grid2">
        <Field label="Default agent">
          <select className="select" value={config.ai.defaultAgent} onChange={e => set('ai.defaultAgent', e.target.value)}>
            <option value="claude">Claude Code</option><option value="codex">Codex</option><option value="opencode">OpenCode</option>
          </select>
        </Field>
        <Field label="Idle alert after (s)" hint="agent stops printing"><input className="input" type="number" min={2} max={120} value={config.notifications.agentIdleSeconds} onChange={e => set('notifications.agentIdleSeconds', Number(e.target.value))} /></Field>
      </div>
      <div className="checks">
        <label className="check"><input type="checkbox" checked={config.ai.resumeOnRestore} onChange={e => set('ai.resumeOnRestore', e.target.checked)} /> Resume the previous conversation when a closed agent tab is restored</label>
        <label className="check"><input type="checkbox" checked={config.notifications.onAgentIdle} onChange={e => set('notifications.onAgentIdle', e.target.checked)} /> Notify when an agent in a background tab is waiting for input</label>
      </div>
      <Field label="Global system prompt" hint="prepended to every workspace prompt">
        <textarea className="input mono tall" value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => set('ai.globalPrompt', draft)}
          placeholder="Reply in Spanish. Prefer small, reviewable commits." />
      </Field>
    </>
  )
}

function TransfersSection() {
  const { config, set } = useCfg()
  return (
    <div className="grid2">
      <Field label="If the file exists">
        <select className="select" value={config.transfers.policy} onChange={e => set('transfers.policy', e.target.value)}>
          {['ask', 'overwrite', 'newer', 'different', 'resume', 'rename', 'skip'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Parallel files per transfer"><input className="input" type="number" min={1} max={6} value={config.transfers.concurrency} onChange={e => set('transfers.concurrency', Number(e.target.value))} /></Field>
      <label className="check"><input type="checkbox" checked={config.transfers.preserveTimes} onChange={e => set('transfers.preserveTimes', e.target.checked)} /> Preserve modification times</label>
    </div>
  )
}

function KeysSection() {
  const { config, set } = useCfg()
  const style = detectModStyle(useStore.getState().caps?.mode === 'desktop')
  const names = new Map(getCommands().map(c => [c.id, c.label]))
  return (
    <>
      <p className="muted">"mod" is {style === 'cmd' ? '⌘' : style === 'ctrlShift' ? 'Ctrl+Shift' : 'Alt+Shift (inside a browser tab, where the browser owns Ctrl/⌘+T and W)'}{style !== 'cmd' && <>; "shift" in a shortcut means the extra {style === 'ctrlShift' ? 'Alt' : 'Ctrl'} key</>}. Click a shortcut to change it; leave empty to disable.</p>
      <table className="table">
        <tbody>
          {Object.keys(defaultKeys(style)).map(id => {
            const key = config.keymap[id] ?? defaultKeys(style)[id]
            return (
              <tr key={id}><td>{names.get(id) || id}</td>
                <td><button className="kbd" onClick={async () => { const v = await askText(`Shortcut for "${names.get(id) || id}"`, key, 'mod+shift+x'); if (v !== null) set(`keymap.${id}`, v) }}>{key ? keyLabel(key, style) : '—'}</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function AccountSection() {
  const user = useStore(s => s.user)!
  const toast = useStore(s => s.toast)
  const [sessions, setSessions] = useState<any[]>([])
  const [mfa, setMfa] = useState<{ secret: string; uri: string } | null>(null)
  const [otp, setOtp] = useState('')
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const load = () => api.get('/api/auth/sessions').then(setSessions)
  useEffect(() => { load() }, [])
  return (
    <>
      <h3>Password</h3>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); try { await api.put('/api/auth/password', pw); toast('Password changed. Other sessions were signed out.', 'success'); setPw({ current_password: '', new_password: '' }); load() } catch (err: any) { toast(err.message, 'error') } }}>
        <input className="input" type="password" autoComplete="current-password" placeholder="Current password" value={pw.current_password} onChange={e => setPw({ ...pw, current_password: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder="New password (12+ chars)" value={pw.new_password} onChange={e => setPw({ ...pw, new_password: e.target.value })} />
        <button className="btn primary">Change</button>
      </form>
      <h3>Two-factor authentication (TOTP)</h3>
      {user.mfa_enabled ? (
        <div className="row"><span className="ok">Enabled</span><button className="btn sm danger" onClick={async () => {
          const password = await askText('Confirm your password to disable MFA'); if (!password) return
          try { await api.post('/api/auth/mfa/disable', { password }); useStore.getState().set({ user: { ...user, mfa_enabled: false } }); toast('MFA disabled') } catch (e: any) { toast(e.message, 'error') }
        }}>Disable</button></div>
      ) : mfa ? (
        <div>
          <p>Add this key to your authenticator app (1Password, Google Authenticator, Aegis…), then enter the 6-digit code.</p>
          <pre className="preview mono">{mfa.secret}</pre>
          <p className="muted sm break">{mfa.uri}</p>
          <div className="row"><input className="input" inputMode="numeric" placeholder="123456" value={otp} onChange={e => setOtp(e.target.value)} />
            <button className="btn primary" onClick={async () => { try { await api.post('/api/auth/mfa/enable', { otp }); useStore.getState().set({ user: { ...user, mfa_enabled: true } }); setMfa(null); toast('MFA enabled', 'success') } catch (e: any) { toast(e.message, 'error') } }}>Verify & enable</button></div>
        </div>
      ) : <button className="btn" onClick={async () => setMfa(await api.post('/api/auth/mfa/setup'))}>Set up MFA</button>}
      <h3>Signed-in sessions</h3>
      <table className="table">
        <tbody>{sessions.map(s => (
          <tr key={s.id}><td>{s.current ? <b>This browser</b> : s.user_agent?.slice(0, 60)}</td><td className="muted">{s.ip}</td><td className="muted">{timeAgo(s.created_at)} ago</td>
            <td>{!s.current && <button className="btn sm" onClick={async () => { await api.del(`/api/auth/sessions/${s.id}`); load() }}>Revoke</button>}</td></tr>
        ))}</tbody>
      </table>
    </>
  )
}

function SshSection() {
  const [keys, setKeys] = useState<any[]>([])
  const [hosts, setHosts] = useState<any[]>([])
  const [pub, setPub] = useState('')
  const load = () => { api.get('/api/settings/ssh-keys').then(setKeys); api.get('/api/connections/known-hosts').then(setHosts); api.get('/api/settings/public-key').then(r => setPub(r.public_key || r.publicKey || '')) }
  useEffect(load, [])
  return (
    <>
      <h3>Your default public key</h3>
      <p className="muted">Add it to <code>~/.ssh/authorized_keys</code> on your servers to log in without a password.</p>
      <pre className="preview mono break">{pub}</pre>
      <button className="btn sm" onClick={() => navigator.clipboard.writeText(pub)}>Copy</button>
      <h3>Stored keys</h3>
      <table className="table"><tbody>{keys.map(k => <tr key={k.id}><td>{k.name}</td><td className="muted">{k.created_at}</td></tr>)}</tbody></table>
      <h3>Trusted host keys</h3>
      <p className="muted">Pinned on first connection. If a server's key changes you will be warned before connecting.</p>
      <table className="table"><tbody>{hosts.map(h => (
        <tr key={h.id}><td>{h.host}:{h.port}</td><td className="mono sm">{h.fingerprint}</td><td className="muted">{h.key_type}</td>
          <td><button className="btn sm" onClick={async () => { if (await askConfirm(`Forget the key of ${h.host}?`, 'You will be asked to confirm it again on the next connection.')) { await api.del(`/api/connections/known-hosts/${h.id}`); load() } }}>Forget</button></td></tr>
      ))}</tbody></table>
    </>
  )
}

function AdminSection() {
  const user = useStore(s => s.user)!
  const toast = useStore(s => s.toast)
  const [users, setUsers] = useState<any[]>([])
  const [audit, setAudit] = useState<any[]>([])
  const [chain, setChain] = useState<any>(null)
  const load = () => { api.get('/api/admin/users').then(setUsers); api.get('/api/admin/audit', { limit: 100 }).then(setAudit) }
  useEffect(() => { if (user.role === 'admin') load() }, [])
  if (user.role !== 'admin') return <p className="muted">Only administrators can manage users and the audit log.</p>
  const create = async () => {
    const username = await askText('Username'); if (!username) return
    const email = await askText('Email'); if (!email) return
    const password = await askText('Initial password (12+ chars)'); if (!password) return
    try { await api.post('/api/admin/users', { username, email, password, role: 'user' }); load() } catch (e: any) { toast(e.message, 'error') }
  }
  return (
    <>
      <div className="row"><h3>Users</h3><span className="spacer" /><button className="btn sm" onClick={create}>Add user</button></div>
      <table className="table"><thead><tr><th>User</th><th>Role</th><th>MFA</th><th>Last login</th><th /></tr></thead><tbody>{users.map(u => (
        <tr key={u.id} className={u.disabled ? 'muted' : ''}><td>{u.username}<div className="muted sm">{u.email}</div></td>
          <td><select className="select sm" value={u.role} disabled={u.id === user.id} onChange={async e => { await api.put(`/api/admin/users/${u.id}`, { role: e.target.value }); load() }}><option value="user">user</option><option value="admin">admin</option></select></td>
          <td>{u.mfa_enabled ? 'yes' : <span className="warn">no</span>}</td><td className="muted">{u.last_login_at || '—'}</td>
          <td className="row">
            {u.id !== user.id && <button className="btn sm" onClick={async () => { await api.put(`/api/admin/users/${u.id}`, { disabled: !u.disabled }); load() }}>{u.disabled ? 'Enable' : 'Disable'}</button>}
            <button className="btn sm" onClick={async () => { await api.put(`/api/admin/users/${u.id}`, { unlock: true }); toast('Unlocked') }}>Unlock</button>
            <button className="btn sm" onClick={async () => { await api.del(`/api/admin/users/${u.id}/sessions`); toast('Sessions revoked') }}>Sign out</button>
          </td></tr>
      ))}</tbody></table>
      <div className="row"><h3>Audit log</h3><span className="spacer" />
        <button className="btn sm" onClick={async () => setChain(await api.get('/api/admin/audit/verify'))}>Verify integrity</button>
        <a className="btn sm" href="/api/admin/audit/export">Export (JSONL)</a>
      </div>
      {chain && <p className={chain.ok ? 'ok' : 'error'}>{chain.ok ? `Chain intact (${chain.checked} entries verified)` : `Chain BROKEN at entry #${chain.brokenAt}`}</p>}
      <table className="table sm"><tbody>{audit.map(a => (
        <tr key={a.id}><td className="muted">{a.created_at?.replace('T', ' ').slice(0, 19)}</td><td>{a.username || a.user_id}</td><td><b>{a.action}</b></td><td className="mono sm">{a.path || ''}</td><td className="muted">{a.ip}</td></tr>
      ))}</tbody></table>
    </>
  )
}

function JsonSection() {
  const ref = useRef<HTMLDivElement>(null)
  const userConfig = useStore(s => s.userConfig)
  const [err, setErr] = useState('')
  const edRef = useRef<any>(null)
  useEffect(() => {
    let ed: any
    loadMonaco().then(monaco => {
      defineThemes(monaco, useStore.getState().theme)
      ed = monaco.editor.create(ref.current!, {
        value: JSON.stringify(userConfig, null, 2), language: 'json', automaticLayout: true, minimap: { enabled: false },
        fontFamily: useStore.getState().config.fontFamily, fontSize: 13, scrollBeyondLastLine: false,
      })
      edRef.current = ed
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save())
    })
    return () => ed?.dispose()
  }, [])
  const save = () => {
    try { const v = JSON.parse(edRef.current.getValue()); useStore.getState().saveConfig(v); setErr(''); useStore.getState().toast('Config applied', 'success') }
    catch (e: any) { setErr(e.message) }
  }
  return (
    <>
      <p className="muted">Only values that differ from the defaults are stored. Press ⌘/Ctrl+S to apply. <button className="link" onClick={() => edRef.current?.setValue(JSON.stringify(DEFAULT_CONFIG, null, 2))}>Show all defaults</button></p>
      <div ref={ref} className="json-editor" />
      <div className="row">{err && <span className="error">{err}</span>}<span className="spacer" /><button className="btn primary" onClick={save}>Apply</button></div>
    </>
  )
}

export function SettingsPanel(props: IDockviewPanelProps<{ section?: string }>) {
  const [section, setSection] = useState(props.params.section || 'appearance')
  useEffect(() => { if (props.params.section) setSection(props.params.section) }, [props.params.section])
  const Body = { appearance: Appearance, terminal: TerminalSection, ai: AiSection, transfers: TransfersSection, keys: KeysSection, account: AccountSection, ssh: SshSection, admin: AdminSection, json: JsonSection }[section] || Appearance
  return (
    <div className="settings">
      <nav className="settings-nav">
        {SECTIONS.map(([id, label]) => <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>{label}</button>)}
        <div className="spacer" />
        <button onClick={async () => { await api.post('/api/auth/logout'); location.reload() }}>Sign out</button>
      </nav>
      <div className="settings-body scroll-panel"><h2>{SECTIONS.find(s => s[0] === section)?.[1]}</h2><Body /></div>
    </div>
  )
}
