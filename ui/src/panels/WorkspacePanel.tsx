import { useEffect, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { Sparkles, Trash2, Play } from 'lucide-react'
import { api } from '../api'
import { useStore, sourceLabel } from '../store'
import { openTerminal } from '../layout'
import { askConfirm } from '../dialogs/Prompt'
import type { AgentId, Workspace } from '../types'

const empty = (d?: { connection_id?: number | null; path?: string }): Partial<Workspace> => ({
  name: '', path: d?.path || '', connection_id: d?.connection_id ?? null, system_prompt: '', agent: 'claude', agent_args: '', context: '', inherit: 1,
})

export function WorkspacePanel(props: IDockviewPanelProps<{ workspaceId: number | 'new'; defaults?: { connection_id?: number | null; path?: string } }>) {
  const workspaces = useStore(s => s.workspaces)
  const sites = useStore(s => s.sites)
  const caps = useStore(s => s.caps)
  const [ws, setWs] = useState<Partial<Workspace>>(empty(props.params.defaults))
  const [id, setId] = useState<number | 'new'>(props.params.workspaceId)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const toast = useStore(s => s.toast)

  useEffect(() => {
    setId(props.params.workspaceId)
    if (props.params.workspaceId === 'new') setWs(empty(props.params.defaults))
    else { const found = workspaces.find(w => w.id === props.params.workspaceId); if (found) setWs(found) }
  }, [props.params.workspaceId, workspaces.length])

  useEffect(() => { props.api.setTitle(ws.name ? `AI · ${ws.name}` : 'New AI workspace') }, [ws.name])

  const save = async () => {
    setSaving(true)
    try {
      const body = { ...ws, connection_id: ws.connection_id || null }
      if (id === 'new') {
        const r = await api.post('/api/workspaces', body)
        setId(r.id)
        props.api.updateParameters({ workspaceId: r.id, key: `ws-${r.id}` })
      } else await api.put(`/api/workspaces/${id}`, body)
      await useStore.getState().loadWorkspaces()
      toast('Workspace saved', 'success')
    } catch (e: any) { toast(e.message, 'error') } finally { setSaving(false) }
  }

  const remove = async () => {
    if (id === 'new' || !(await askConfirm('Delete this AI workspace?', 'The system prompt and saved context will be lost.', true))) return
    await api.del(`/api/workspaces/${id}`)
    await useStore.getState().loadWorkspaces()
    props.api.close()
  }

  const showPreview = async () => {
    const r = await api.get('/api/workspaces/resolve', { connection_id: ws.connection_id || undefined, path: ws.path })
    setPreview(r.prompt || '(empty — nothing will be injected)')
  }

  const launch = (agent: AgentId) => openTerminal({ kind: ws.connection_id ? 'ssh' : 'local', connectionId: ws.connection_id || null, cwd: ws.path, agent })

  const f = (k: keyof Workspace) => ({ value: (ws[k] as any) ?? '', onChange: (e: any) => setWs({ ...ws, [k]: e.target.value }) })

  return (
    <div className="scroll-panel form-panel">
      <div className="panel-head"><Sparkles size={18} /><h2>{id === 'new' ? 'New AI workspace' : ws.name}</h2><span className="spacer" />
        {id !== 'new' && <button className="btn sm danger" onClick={remove}><Trash2 size={14} /> Delete</button>}
        <button className="btn sm primary" disabled={saving || !ws.path} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <p className="muted">A workspace binds a folder (local or on a site) to a system prompt and saved context. Whenever you start
        Claude Code, Codex or OpenCode in that folder (or a sub-folder, if inherited) from CodeFromHere, the prompt is injected automatically:
        <code>--append-system-prompt-file</code> for Claude, <code>developer_instructions</code> for Codex and <code>instructions</code> for OpenCode.</p>
      <div className="grid2">
        <label>Name<input className="input" {...f('name')} placeholder="My project" /></label>
        <label>Where
          <select className="select" value={ws.connection_id ?? ''} onChange={(e) => setWs({ ...ws, connection_id: e.target.value ? Number(e.target.value) : null })}>
            {caps?.localShell && <option value="">💻 Local machine</option>}
            {sites.filter(s => ['ssh', 'sftp', 'scp'].includes(s.type)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="span2">Folder<input className="input mono" {...f('path')} placeholder="/home/me/project" /></label>
        <label>Default agent
          <select className="select" {...f('agent')}>
            {(caps?.agents || []).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label>Extra agent arguments<input className="input mono" {...f('agent_args')} placeholder="--model opus" /></label>
        <label className="check span2"><input type="checkbox" checked={!!ws.inherit} onChange={(e) => setWs({ ...ws, inherit: e.target.checked ? 1 : 0 })} /> Also apply to sub-folders</label>
      </div>
      <label>System prompt
        <textarea className="input mono tall" {...f('system_prompt')} placeholder={'You are working on the billing service.\nAlways run `npm test` before finishing.\nAnswer in Spanish.'} />
      </label>
      <label>Saved context <span className="muted">(notes, decisions, conventions — appended to the prompt; edit it as the project evolves)</span>
        <textarea className="input mono" rows={8} {...f('context')} placeholder="- Staging DB is read-only&#10;- We deploy with ./deploy.sh" />
      </label>
      <div className="row">
        <button className="btn sm" onClick={showPreview} disabled={!ws.path}>Preview effective prompt</button>
        <span className="spacer" />
        {(caps?.agents || []).filter(a => a.id !== 'shell').map(a => (
          <button key={a.id} className="btn sm" disabled={!ws.path || id === 'new'} title={id === 'new' ? 'Save first' : ''} onClick={() => launch(a.id)}><Play size={13} /> {a.label}</button>
        ))}
      </div>
      {preview !== null && <pre className="preview">{preview}</pre>}
      <p className="muted sm">Location: {sourceLabel(ws.connection_id || 'local')} · {ws.path || '—'}. The global prompt (Settings → AI) is prepended to every workspace.</p>
    </div>
  )
}
