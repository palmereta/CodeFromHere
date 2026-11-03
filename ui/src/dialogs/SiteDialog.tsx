import { useState } from 'react'
import { api } from '../api'
import { useStore, withHostKey } from '../store'
import { Modal } from './Prompt'
import type { Site, SiteType } from '../types'

const TYPES: { id: SiteType; label: string; port?: number }[] = [
  { id: 'ssh', label: 'SSH + SFTP', port: 22 }, { id: 'scp', label: 'SCP / shell (no SFTP)', port: 22 },
  { id: 'ftp', label: 'FTP', port: 21 }, { id: 'ftps', label: 'FTPS (TLS)', port: 21 },
  { id: 's3', label: 'S3 / compatible' }, { id: 'telnet', label: 'Telnet', port: 23 },
]
const COLORS = ['#6366f1', '#22c55e', '#ef4444', '#f59e0b', '#06b6d4', '#ec4899', '#a855f7', '#64748b']

export function SiteDialog() {
  const dlg = useStore(s => s.siteDialog)!
  const groups = useStore(s => s.groups)
  const sites = useStore(s => s.sites)
  const isDesktop = useStore(s => s.caps?.mode === 'desktop')
  const editing = !!dlg.site?.id
  const [f, setF] = useState<any>({ type: 'ssh', port: 22, color: COLORS[0], root_path: '/', tls_verify: 1, ...dlg.site, password: '', private_key: '', passphrase: '', access_key: '', secret_key: '' })
  const [auth, setAuth] = useState<'password' | 'key' | 'default' | 'agent'>(dlg.site?.use_agent ? 'agent' : dlg.site?.has_private_key ? 'key' : dlg.site?.has_password ? 'password' : 'default')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const close = () => useStore.getState().set({ siteDialog: null })
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }))
  const sshLike = ['ssh', 'sftp', 'scp'].includes(f.type)

  const payload = () => {
    const p: any = { ...f }
    for (const k of Object.keys(p)) if (k.startsWith('has_') || ['id', 'last_connected', 'created_at', 'updated_at'].includes(k)) delete p[k]
    p.port = p.port ? Number(p.port) : null
    p.group_id = p.group_id ? Number(p.group_id) : null
    p.jump_id = p.jump_id ? Number(p.jump_id) : null
    if (sshLike) {
      p.use_agent = auth === 'agent' ? 1 : 0
      if (auth !== 'password' && editing && dlg.site?.has_password) p.password = null
      if (auth !== 'key' && editing && dlg.site?.has_private_key) { p.private_key = null; p.passphrase = null }
    }
    return p
  }

  const save = async (andTest = false) => {
    setBusy(true); setTest(null)
    try {
      let id = dlg.site?.id
      if (editing) await api.put(`/api/connections/${id}`, payload())
      else { id = (await api.post('/api/connections', payload())).id; useStore.getState().set({ siteDialog: { site: { ...f, id } } }) }
      await useStore.getState().loadSites()
      if (andTest && f.type !== 'telnet') {
        const r = await withHostKey(async () => { const x = await api.post(`/api/connections/${id}/test`); if (!x.ok) throw Object.assign(new Error(x.error), { data: x }); return x })
        setTest({ ok: true, text: r.message })
      } else if (!andTest) close()
    } catch (e: any) { setTest({ ok: false, text: e.message }) } finally { setBusy(false) }
  }

  const input = (k: string, props: any = {}) => <input className="input" value={f[k] ?? ''} onChange={e => set(k, e.target.value)} {...props} />

  return (
    <Modal title={editing ? `Edit ${dlg.site?.name}` : 'New site'} onClose={close} wide>
      <div className="grid2">
        <label>Name{input('name', { autoFocus: true, placeholder: 'Production web' })}</label>
        <label>Protocol
          <select className="select" value={f.type} onChange={e => { const t = TYPES.find(x => x.id === e.target.value)!; setF((x: any) => ({ ...x, type: t.id, port: t.port ?? null })) }}>
            {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        {f.type !== 's3' ? <>
          <label>Host{input('host', { placeholder: 'example.com' })}</label>
          <label>Port{input('port', { type: 'number' })}</label>
          {f.type !== 'telnet' && <label>Username{input('username', { autoComplete: 'off' })}</label>}
        </> : <>
          <label>Bucket{input('bucket')}</label>
          <label>Region{input('region', { placeholder: 'us-east-1' })}</label>
          <label className="span2">Endpoint <span className="muted sm">(empty for AWS; MinIO, Wasabi, B2, R2…)</span>{input('endpoint', { placeholder: 'https://s3.example.com' })}</label>
          <label>Access key{input('access_key', { placeholder: dlg.site?.has_access_key ? '•••••• (unchanged)' : '' })}</label>
          <label>Secret key{input('secret_key', { type: 'password', placeholder: dlg.site?.has_secret_key ? '•••••• (unchanged)' : '' })}</label>
        </>}
        {sshLike && (
          <label>Authentication
            <select className="select" value={auth} onChange={e => setAuth(e.target.value as any)}>
              <option value="default">My CodeFromHere key</option><option value="password">Password</option><option value="key">Private key</option>
              {isDesktop && <option value="agent">ssh-agent / Pageant</option>}
            </select>
          </label>
        )}
        {(['ftp', 'ftps'].includes(f.type) || (sshLike && auth === 'password')) && (
          <label>Password{input('password', { type: 'password', autoComplete: 'new-password', placeholder: dlg.site?.has_password ? '•••••• (unchanged)' : '' })}</label>
        )}
        {sshLike && auth === 'key' && <>
          <label className="span2">Private key (PEM / OpenSSH)<textarea className="input mono" rows={4} value={f.private_key} onChange={e => set('private_key', e.target.value)} placeholder={dlg.site?.has_private_key ? '•••••• (unchanged)' : '-----BEGIN OPENSSH PRIVATE KEY-----'} /></label>
          <label>Passphrase{input('passphrase', { type: 'password', placeholder: dlg.site?.has_passphrase ? '•••••• (unchanged)' : '' })}</label>
        </>}
        {f.type === 'ftps' && <label className="check"><input type="checkbox" checked={!!f.ftps_implicit} onChange={e => set('ftps_implicit', e.target.checked ? 1 : 0)} /> Implicit TLS (port 990)</label>}
        {f.type === 'ftps' && <label className="check"><input type="checkbox" checked={f.tls_verify !== 0} onChange={e => set('tls_verify', e.target.checked ? 1 : 0)} /> Verify TLS certificate</label>}
        {f.type !== 's3' && f.type !== 'telnet' && <label>Initial folder{input('root_path', { placeholder: '/' })}</label>}
        <label>Group
          <select className="select" value={f.group_id ?? ''} onChange={e => set('group_id', e.target.value || null)}>
            <option value="">(none)</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        {sshLike && <>
          <label>Jump host
            <select className="select" value={f.jump_id ?? ''} onChange={e => set('jump_id', e.target.value || null)}>
              <option value="">(direct)</option>{sites.filter(s => s.id !== f.id && ['ssh', 'sftp', 'scp'].includes(s.type)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Startup command{input('startup_command', { placeholder: 'source ~/.venv/bin/activate' })}</label>
          <label className="check span2"><input type="checkbox" checked={!!f.use_tmux} onChange={e => set('use_tmux', e.target.checked ? 1 : 0)} /> Keep terminals alive in <b>tmux</b> on the server (survives disconnects and restarts)</label>
        </>}
        <label>Tags{input('tags', { placeholder: 'prod, web' })}</label>
        <label>Color<div className="colors">{COLORS.map(c => <button type="button" key={c} className={`swatch${f.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} />)}</div></label>
        <label className="span2">Notes<textarea className="input" rows={2} value={f.notes ?? ''} onChange={e => set('notes', e.target.value)} /></label>
      </div>
      {test && <div className={test.ok ? 'ok' : 'error'}>{test.text}</div>}
      <div className="modal-actions">
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn" disabled={busy || !f.name} onClick={() => save(true)}>Save & test</button>
        <button className="btn primary" disabled={busy || !f.name} onClick={() => save(false)}>Save</button>
      </div>
    </Modal>
  )
}
