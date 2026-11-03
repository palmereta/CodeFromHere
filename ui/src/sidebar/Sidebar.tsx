import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, File, Plus, Search, Server, Sparkles, History, FolderTree, RefreshCw, MonitorDot, Upload, Settings as Cog, ArrowDownUp } from 'lucide-react'
import { api, timeAgo, formatBytes } from '../api'
import { useStore, withHostKey, sourceLabel, siteById } from '../store'
import { openSiteTerminal, openFiles, openEditor, openTerminal, openWorkspace, openSettings, openTransfers, getDock } from '../layout'
import { Menu, type MenuItem } from '../components/Menu'
import { AgentIcon, SiteIcon } from '../components/Icons'
import { askConfirm, askText } from '../dialogs/Prompt'
import { ImportDialog } from '../dialogs/ImportDialog'
import type { AgentHistoryItem, FileEntry, Site, SiteGroup, Source } from '../types'

// ---------------------------------------------------------------- Sites ----

function SitesTab() {
  const { sites, groups, caps } = useStore()
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set(groups.filter(g => g.collapsed).map(g => g.id)))
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const toast = useStore(s => s.toast)
  const reload = () => useStore.getState().loadSites()

  const filtered = useMemo(() => {
    const f = q.toLowerCase()
    return f ? sites.filter(s => [s.name, s.host, s.username, s.tags, s.bucket].some(v => v?.toLowerCase().includes(f))) : sites
  }, [sites, q])

  const toggle = (g: SiteGroup) => {
    const next = new Set(collapsed)
    next.has(g.id) ? next.delete(g.id) : next.add(g.id)
    setCollapsed(next)
    api.put(`/api/connections/groups/${g.id}`, { collapsed: next.has(g.id) }).catch(() => {})
  }

  const moveSite = async (siteId: number, groupId: number | null, beforeId?: number) => {
    const inGroup = sites.filter(s => s.group_id === groupId && s.id !== siteId).sort((a, b) => a.sort_order - b.sort_order)
    const idx = beforeId ? inGroup.findIndex(s => s.id === beforeId) : inGroup.length
    inGroup.splice(idx < 0 ? inGroup.length : idx, 0, sites.find(s => s.id === siteId)!)
    await api.put('/api/connections/reorder', { items: inGroup.map((s, i) => ({ id: s.id, group_id: groupId, sort_order: i })) })
    reload()
  }
  const moveGroup = async (groupId: number, parentId: number | null) => {
    try { await api.put(`/api/connections/groups/${groupId}`, { parent_id: parentId }); reload() } catch (e: any) { toast(e.message, 'error') }
  }

  const onDrop = (e: React.DragEvent, groupId: number | null, beforeSite?: number) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(null)
    const site = e.dataTransfer.getData('application/x-cfh-site')
    const group = e.dataTransfer.getData('application/x-cfh-group')
    if (site) moveSite(Number(site), groupId, beforeSite)
    else if (group && Number(group) !== groupId) moveGroup(Number(group), groupId)
  }

  const siteMenu = (e: React.MouseEvent, s: Site) => {
    e.preventDefault(); e.stopPropagation()
    const shell = ['ssh', 'sftp', 'scp', 'telnet'].includes(s.type)
    const items: MenuItem[] = []
    if (shell) {
      items.push({ label: 'Open terminal', icon: <AgentIcon agent="shell" size={14} />, onClick: () => openSiteTerminal(s.id) })
      items.push({ label: 'Open in split', onClick: () => openSiteTerminal(s.id, 'right') })
      if (s.type !== 'telnet') for (const a of caps?.agents.filter(a => a.id !== 'shell') || []) items.push({ label: `Open ${a.label}`, icon: <AgentIcon agent={a.id} size={14} />, onClick: () => openSiteTerminal(s.id, 'tab', a.id) })
    }
    if (s.type !== 'telnet') items.push({ label: 'Browse files', icon: <FolderTree size={14} />, onClick: () => openFiles({ left: caps?.localShell ? 'local' : s.id, right: caps?.localShell ? s.id : null }) })
    items.push({ separator: true },
      { label: 'Edit…', onClick: () => useStore.getState().set({ siteDialog: { site: s } }) },
      { label: 'Duplicate', onClick: async () => { await api.post(`/api/connections/${s.id}/duplicate`); reload() } },
      { label: 'Test connection', onClick: async () => {
        const r = await api.post(`/api/connections/${s.id}/test`)
        if (!r.ok && (r.code === 'HOSTKEY_UNKNOWN' || r.code === 'HOSTKEY_MISMATCH')) {
          await withHostKey(async () => { const x = await api.post(`/api/connections/${s.id}/test`); if (!x.ok) throw Object.assign(new Error(x.error), { data: x }); return x }).then(x => toast(x.message, 'success')).catch(err => toast(err.message, 'error'))
        } else toast(r.ok ? r.message : r.error, r.ok ? 'success' : 'error')
      } },
      { separator: true },
      { label: 'Delete', danger: true, onClick: async () => { if (await askConfirm(`Delete site "${s.name}"?`, undefined, true)) { await api.del(`/api/connections/${s.id}`); reload() } } })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const groupMenu = (e: React.MouseEvent, g: SiteGroup | null) => {
    e.preventDefault(); e.stopPropagation()
    const items: MenuItem[] = [
      { label: 'New site here…', onClick: () => useStore.getState().set({ siteDialog: { site: { group_id: g?.id ?? null } } }) },
      { label: 'New group…', onClick: async () => { const name = await askText('Group name'); if (name) { await api.post('/api/connections/groups', { name, parent_id: g?.id ?? null }); reload() } } },
    ]
    if (g) items.push(
      { label: 'Rename…', onClick: async () => { const name = await askText('Rename group', g.name); if (name) { await api.put(`/api/connections/groups/${g.id}`, { name }); reload() } } },
      { label: 'Open all terminals', onClick: () => sites.filter(s => s.group_id === g.id && ['ssh', 'sftp', 'scp', 'telnet'].includes(s.type)).forEach(s => openSiteTerminal(s.id)) },
      { separator: true },
      { label: 'Delete group', danger: true, onClick: async () => { if (await askConfirm(`Delete group "${g.name}"?`, 'Sites inside are kept and moved to the top level; sub-groups are deleted.', true)) { await api.del(`/api/connections/groups/${g.id}`); reload() } } })
    items.push({ separator: true }, { label: 'Import sites…', icon: <Upload size={14} />, onClick: () => setImporting(true) })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const renderSite = (s: Site, depth: number) => (
    <div key={s.id} className={`tree-row site${dragOver === `s${s.id}` ? ' drop-before' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} draggable
      onDragStart={(e) => { e.dataTransfer.setData('application/x-cfh-site', String(s.id)); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-cfh-site')) { e.preventDefault(); setDragOver(`s${s.id}`) } }}
      onDragLeave={() => setDragOver(null)}
      onDrop={(e) => onDrop(e, s.group_id, s.id)}
      onDoubleClick={() => openSiteTerminal(s.id)}
      onContextMenu={(e) => siteMenu(e, s)}
      title={`${s.type.toUpperCase()} ${s.username ? s.username + '@' : ''}${s.host || s.bucket || ''}${s.port ? ':' + s.port : ''}\nDouble-click to connect`}>
      <span className="site-dot" style={{ background: s.color || '#666' }} />
      <SiteIcon type={s.type} size={13} />
      <span className="tree-label">{s.name}</span>
      <span className="tree-meta">{s.type}</span>
    </div>
  )

  const renderGroup = (g: SiteGroup, depth: number): React.ReactNode => {
    const open = !collapsed.has(g.id) || !!q
    const kids = groups.filter(x => x.parent_id === g.id)
    const items = filtered.filter(s => s.group_id === g.id)
    if (q && !items.length && !kids.length) return null
    return (
      <div key={`g${g.id}`}>
        <div className={`tree-row group${dragOver === `g${g.id}` ? ' drop-into' : ''}`} style={{ paddingLeft: 4 + depth * 14 }} draggable
          onDragStart={(e) => { e.dataTransfer.setData('application/x-cfh-group', String(g.id)); e.stopPropagation() }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(`g${g.id}`) }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => onDrop(e, g.id)}
          onClick={() => toggle(g)} onContextMenu={(e) => groupMenu(e, g)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {open ? <FolderOpen size={13} /> : <Folder size={13} />}
          <span className="tree-label">{g.name}</span>
          <span className="tree-meta">{sites.filter(s => s.group_id === g.id).length}</span>
        </div>
        {open && <>{kids.map(k => renderGroup(k, depth + 1))}{items.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map(s => renderSite(s, depth + 1))}</>}
      </div>
    )
  }

  return (
    <div className="side-section" onContextMenu={(e) => groupMenu(e, null)}>
      <div className="side-head">
        <div className="side-search"><Search size={13} /><input placeholder="Search sites" value={q} onChange={e => setQ(e.target.value)} /></div>
        <button className="icon-btn" title="New site" onClick={() => useStore.getState().set({ siteDialog: { site: null } })}><Plus size={15} /></button>
        <button className="icon-btn" title="Import (CSV, ~/.ssh/config, FileZilla)" onClick={() => setImporting(true)}><Upload size={14} /></button>
      </div>
      <div className="tree" onDragOver={(e) => { e.preventDefault() }} onDrop={(e) => onDrop(e, null)}>
        {caps?.localShell && (
          <div className="tree-row site" style={{ paddingLeft: 10 }} onDoubleClick={() => openTerminal({ kind: 'local' })}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items: [
              ...caps.agents.map(a => ({ label: a.id === 'shell' ? 'Open terminal' : `Open ${a.label}`, icon: <AgentIcon agent={a.id} size={14} />, onClick: () => openTerminal({ kind: 'local', agent: a.id }) })),
              { label: 'Browse files', icon: <FolderTree size={14} />, onClick: () => openFiles({ left: 'local' }) },
            ] }) }}>
            <span className="site-dot" style={{ background: '#22c55e' }} /><MonitorDot size={13} /><span className="tree-label">This computer</span><span className="tree-meta">local</span>
          </div>
        )}
        {groups.filter(g => !g.parent_id).map(g => renderGroup(g, 0))}
        {filtered.filter(s => !s.group_id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map(s => renderSite(s, 0))}
        {!sites.length && <div className="side-empty muted">No sites yet.<br /><button className="link" onClick={() => useStore.getState().set({ siteDialog: { site: null } })}>Add one</button> or <button className="link" onClick={() => setImporting(true)}>import</button> from ~/.ssh/config, FileZilla or CSV.</div>}
      </div>
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  )
}

// ---------------------------------------------------------- Explorer -------

function TreeNode({ source, entry, depth }: { source: Source; entry: FileEntry; depth: number }) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState<FileEntry[] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const load = async () => setKids((await withHostKey(() => api.get<FileEntry[]>('/api/files/list', { source, path: entry.path }))).sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name)))
  const click = async () => {
    if (!entry.isDir) return openEditor(source, entry.path)
    if (!open && !kids) await load().catch(e => useStore.getState().toast(e.message, 'error'))
    setOpen(!open)
  }
  const shellable = source === 'local' || ['ssh', 'sftp', 'scp'].includes(siteById(source as number)?.type ?? '')
  return (
    <>
      <div className="tree-row file" style={{ paddingLeft: 6 + depth * 12 }} onClick={click} draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-cfh-files', JSON.stringify([{ path: entry.path }]))
          e.dataTransfer.setData('application/x-cfh-transfer', JSON.stringify({ source, items: [entry] }))
          e.dataTransfer.setData('text/plain', entry.path)
        }}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }} title={entry.path}>
        {entry.isDir ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
        {entry.isDir ? <Folder size={13} className="ic-dir" /> : <File size={13} className="ic-file" />}
        <span className="tree-label">{entry.name}</span>
        {!entry.isDir && <span className="tree-meta">{formatBytes(entry.size)}</span>}
      </div>
      {open && kids?.map(k => <TreeNode key={k.path} source={source} entry={k} depth={depth + 1} />)}
      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        entry.isDir ? { label: 'Open in file manager', onClick: () => openFiles({ left: source, leftPath: entry.path }) } : { label: 'Edit', onClick: () => openEditor(source, entry.path) },
        ...(entry.isDir && shellable ? [
          { label: 'Terminal here', onClick: () => openTerminal({ kind: source === 'local' ? 'local' : 'ssh', connectionId: source === 'local' ? null : source, cwd: entry.path }) },
          ...(useStore.getState().caps?.agents.filter(a => a.id !== 'shell') || []).map(a => ({ label: `${a.label} here`, onClick: () => openTerminal({ kind: source === 'local' ? 'local' as const : 'ssh' as const, connectionId: source === 'local' ? null : source, cwd: entry.path, agent: a.id }) })),
          { label: 'AI workspace…', onClick: () => { const ws = useStore.getState().workspaces.find(w => (w.connection_id || 'local') === source && w.path === entry.path); openWorkspace(ws ? ws.id : 'new', { connection_id: source === 'local' ? null : source, path: entry.path }) } },
        ] : []),
        { label: 'Copy path', onClick: () => navigator.clipboard.writeText(entry.path) },
        ...(entry.isDir ? [{ label: 'Refresh', onClick: () => load() }] : []),
      ]} />}
    </>
  )
}

function FilesTab() {
  const context = useStore(s => s.context)
  const caps = useStore(s => s.caps)
  const sites = useStore(s => s.sites)
  const [source, setSource] = useState<Source>(context?.source ?? (caps?.localShell ? 'local' : sites[0]?.id ?? 'local'))
  const [root, setRoot] = useState<string>('')
  const [items, setItems] = useState<FileEntry[]>([])
  const [follow, setFollow] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => { if (follow && context) { setSource(context.source); if (context.cwd) setRoot(context.cwd) } }, [context?.source, context?.cwd, follow])
  useEffect(() => {
    if (!root) { withHostKey(() => api.get('/api/files/home', { source })).then(r => setRoot(r.path)).catch(e => setErr(e.message)); return }
    setErr('')
    withHostKey(() => api.get<FileEntry[]>('/api/files/list', { source, path: root }))
      .then(r => setItems(r.sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name)))).catch(e => setErr(e.message))
  }, [source, root])

  return (
    <div className="side-section">
      <div className="side-head col">
        <div className="row">
          <select className="select sm grow" value={String(source)} onChange={(e) => { setFollow(false); setRoot(''); setSource(e.target.value === 'local' ? 'local' : Number(e.target.value)) }}>
            {caps?.localShell && <option value="local">💻 Local</option>}
            {sites.filter(s => s.type !== 'telnet').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className={`icon-btn${follow ? ' on' : ''}`} title="Follow the focused terminal's folder" onClick={() => setFollow(!follow)}><MonitorDot size={14} /></button>
          <button className="icon-btn" title="Open dual-pane file manager" onClick={() => openFiles({ left: source, leftPath: root })}><FolderTree size={14} /></button>
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setFollow(false); setRoot((e.currentTarget.elements.namedItem('p') as HTMLInputElement).value) }}>
          <input name="p" key={root} className="input sm mono grow" defaultValue={root} />
          <button type="button" className="icon-btn" title="Up" onClick={() => { setFollow(false); setRoot(root.replace(/[\\/][^\\/]+[\\/]?$/, '') || '/') }}>↑</button>
        </form>
      </div>
      <div className="tree">
        {err && <div className="side-empty error">{err}</div>}
        {items.map(i => <TreeNode key={`${source}:${i.path}`} source={source} entry={i} depth={0} />)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------- Sessions -------

function SessionsTab() {
  const sessions = useStore(s => s.sessions)
  const caps = useStore(s => s.caps)
  const context = useStore(s => s.context)
  const [history, setHistory] = useState<AgentHistoryItem[]>([])
  const [scope, setScope] = useState<'folder' | 'all'>('folder')
  const [loading, setLoading] = useState(false)
  const openIds = new Set((getDock()?.panels || []).map(p => p.params?.sessionId).filter(Boolean))

  const loadHistory = async () => {
    if (!caps?.localShell) return
    setLoading(true)
    const cwd = scope === 'folder' && context?.source === 'local' ? context.cwd : undefined
    try { setHistory(await api.get('/api/agents/history', { cwd })) } catch { setHistory([]) } finally { setLoading(false) }
  }
  useEffect(() => { useStore.getState().loadSessions(); loadHistory() }, [scope, context?.cwd])

  const attach = (id: string) => {
    const s = sessions.find(x => x.id === id)!
    const panel = getDock()?.panels.find(p => p.params?.sessionId === id)
    if (panel) return panel.api.setActive()
    openTerminal({ sessionId: s.id, kind: s.kind, connectionId: s.connectionId, cwd: s.cwd, agent: s.agent, agentSessionId: s.agentSessionId, tmuxName: s.tmuxName, title: s.title })
  }

  return (
    <div className="side-section">
      <div className="side-head"><span className="side-title">Running on the server</span><span className="spacer" />
        <button className="icon-btn" title="Refresh" onClick={() => { useStore.getState().loadSessions(); loadHistory() }}><RefreshCw size={13} /></button></div>
      <div className="tree short">
        {!sessions.length && <div className="side-empty muted">No live sessions.</div>}
        {sessions.map(s => (
          <div key={s.id} className="tree-row" onClick={() => attach(s.id)} title={`${s.cwd || ''}\nstarted ${timeAgo(s.createdAt)} ago`}>
            <AgentIcon agent={s.agent} />
            <span className="tree-label">{s.title || s.id}</span>
            <span className={`tree-meta ${openIds.has(s.id) ? 'ok' : 'warn'}`}>{s.status !== 'running' ? s.status : openIds.has(s.id) ? 'open' : 'detached'}</span>
          </div>
        ))}
      </div>
      {caps?.localShell && <>
        <div className="side-head"><History size={13} /><span className="side-title">Agent conversations</span><span className="spacer" />
          <select className="select xs" value={scope} onChange={e => setScope(e.target.value as any)}>
            <option value="folder">this folder</option><option value="all">all</option>
          </select>
        </div>
        <div className="tree">
          {loading && <div className="side-empty muted">Loading…</div>}
          {!loading && !history.length && <div className="side-empty muted">No previous Claude / Codex / OpenCode sessions{scope === 'folder' && context?.cwd ? ` in ${context.cwd}` : ''}.</div>}
          {history.map(h => (
            <div key={`${h.agent}:${h.id}`} className="tree-row hist" title={`${h.title}\n${h.cwd || ''}\nClick to resume`}
              onClick={() => openTerminal({ kind: 'local', cwd: h.cwd, agent: h.agent, agentSessionId: h.agent === 'claude' ? h.id : null, resume: { id: h.id } })}>
              <AgentIcon agent={h.agent} />
              <span className="tree-label">{h.title}</span>
              <span className="tree-meta">{timeAgo(h.updatedAt)}</span>
            </div>
          ))}
        </div>
      </>}
    </div>
  )
}

// --------------------------------------------------------------- AI -------

function AiTab() {
  const workspaces = useStore(s => s.workspaces)
  const context = useStore(s => s.context)
  const caps = useStore(s => s.caps)
  const [resolved, setResolved] = useState<{ workspace: any; prompt: string } | null>(null)
  useEffect(() => {
    if (!context?.cwd) { setResolved(null); return }
    api.get('/api/workspaces/resolve', { connection_id: context.source === 'local' ? undefined : context.source, path: context.cwd }).then(setResolved).catch(() => setResolved(null))
  }, [context?.source, context?.cwd, workspaces])
  return (
    <div className="side-section">
      <div className="side-head"><Sparkles size={13} /><span className="side-title">Current folder</span></div>
      <div className="side-card">
        {context?.cwd ? <>
          <div className="mono sm break">{sourceLabel(context.source)}:{context.cwd}</div>
          {resolved?.workspace ? <div className="ok sm">Workspace: <b>{resolved.workspace.name}</b>{resolved.workspace.path !== context.cwd ? ' (inherited)' : ''}</div> : <div className="muted sm">No workspace — agents start with the global prompt only.</div>}
          <div className="row wrap">
            {resolved?.workspace
              ? <button className="btn xs" onClick={() => openWorkspace(resolved.workspace.id)}>Edit prompt</button>
              : <button className="btn xs" onClick={() => openWorkspace('new', { connection_id: context.source === 'local' ? null : context.source, path: context.cwd! })}>Create workspace</button>}
            {(caps?.agents || []).filter(a => a.id !== 'shell').map(a => (
              <button key={a.id} className="btn xs" onClick={() => openTerminal({ kind: context.source === 'local' ? 'local' : 'ssh', connectionId: context.source === 'local' ? null : context.source, cwd: context.cwd, agent: a.id })}><AgentIcon agent={a.id} size={12} /> {a.label}</button>
            ))}
          </div>
        </> : <div className="muted sm">Focus a terminal (shells that report their folder via OSC 7) or open a file to see its workspace.</div>}
      </div>
      <div className="side-head"><span className="side-title">Workspaces</span><span className="spacer" />
        <button className="icon-btn" title="New workspace" onClick={() => openWorkspace('new', { connection_id: context?.source === 'local' ? null : (context?.source as number), path: context?.cwd ?? undefined })}><Plus size={14} /></button>
      </div>
      <div className="tree">
        {!workspaces.length && <div className="side-empty muted">Bind a folder to a system prompt and saved context. Agents launched there get it automatically.</div>}
        {workspaces.map(w => (
          <div key={w.id} className="tree-row" onClick={() => openWorkspace(w.id)} title={`${sourceLabel(w.connection_id || 'local')}:${w.path}`}>
            <AgentIcon agent={w.agent || 'claude'} />
            <span className="tree-label">{w.name}</span>
            <span className="tree-meta">{w.connection_id ? sourceLabel(w.connection_id) : 'local'}</span>
          </div>
        ))}
      </div>
      <div className="side-foot"><button className="link" onClick={() => openSettings('ai')}>Global prompt & agent settings</button></div>
    </div>
  )
}

// ----------------------------------------------------------- Shell --------

export function Sidebar() {
  const tab = useStore(s => s.sidebarTab)
  const visible = useStore(s => s.sidebarVisible)
  const width = useStore(s => s.config.sidebar.width)
  const running = useStore(s => s.transfers.filter(t => t.status === 'running').length)
  const set = useStore(s => s.set)
  const [w, setW] = useState(width)
  useEffect(() => setW(width), [width])

  const tabs = [
    ['sites', <Server size={17} />, 'Sites'], ['files', <FolderTree size={17} />, 'Explorer'],
    ['sessions', <History size={17} />, 'Sessions'], ['ai', <Sparkles size={17} />, 'AI workspaces'],
  ] as const

  return (
    <>
      <div className="rail">
        {tabs.map(([id, icon, label]) => (
          <button key={id} className={tab === id && visible ? 'on' : ''} title={label}
            onClick={() => set(tab === id && visible ? { sidebarVisible: false } : { sidebarTab: id, sidebarVisible: true })}>{icon}</button>
        ))}
        <div className="spacer" />
        <button title="Transfers" onClick={openTransfers} className={running ? 'busy' : ''}><ArrowDownUp size={17} />{running > 0 && <span className="rail-badge">{running}</span>}</button>
        <button title="Settings" onClick={() => openSettings()}><Cog size={17} /></button>
      </div>
      {visible && (
        <aside className="sidebar" style={{ width: w }}>
          {tab === 'sites' && <SitesTab />}
          {tab === 'files' && <FilesTab />}
          {tab === 'sessions' && <SessionsTab />}
          {tab === 'ai' && <AiTab />}
          <div className="sidebar-resize" onMouseDown={(e) => {
            const startX = e.clientX, startW = w
            const move = (ev: MouseEvent) => setW(Math.max(180, Math.min(600, startW + ev.clientX - startX)))
            const up = (ev: MouseEvent) => {
              window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
              const st = useStore.getState()
              st.saveConfig({ ...st.userConfig, sidebar: { ...st.config.sidebar, width: Math.max(180, Math.min(600, startW + ev.clientX - startX)) } })
            }
            window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
          }} />
        </aside>
      )}
    </>
  )
}
