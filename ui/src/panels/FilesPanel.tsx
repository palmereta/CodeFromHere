import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { ArrowLeft, ArrowRight, ArrowUp, Columns2, Copy, Download, File, FilePlus, Folder, FolderPlus, GitCompare, Home, Move, RefreshCw, Scissors, SquareTerminal, Sparkles, Trash2, Upload, Pencil, KeyRound, Link } from 'lucide-react'
import { api, formatBytes, formatDate } from '../api'
import { useStore, withHostKey, sourceLabel, siteById } from '../store'
import { openEditor, openTerminal, openWorkspace } from '../layout'
import { askConfirm, askText } from '../dialogs/Prompt'
import { Menu, type MenuItem } from '../components/Menu'
import { startTransfer, uploadFiles, filesFromDrop, downloadFile, POLICY_LABELS } from '../transfers'
import type { FileEntry, Source } from '../types'

type CompareState = 'same' | 'only-left' | 'only-right' | 'newer-left' | 'newer-right' | 'different' | 'type-differs'

const join = (dir: string, name: string) => (dir.includes('\\') && !dir.includes('/') ? `${dir.replace(/\\+$/, '')}\\${name}` : `${dir.replace(/\/+$/, '')}/${name}`)
const parent = (p: string) => {
  const win = /^[A-Za-z]:\\/.test(p)
  const sep = win ? '\\' : '/'
  const parts = p.split(/[\\/]/).filter(Boolean)
  parts.pop()
  return win ? (parts.length > 1 ? parts.join(sep) : parts[0] + '\\') : '/' + parts.join('/')
}
const modeStr = (m?: number | null) => m === null || m === undefined ? '' : [6, 3, 0].map(s => ((m >> s) & 7)).map(n => (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-')).join('')

interface PaneProps {
  side: 'left' | 'right'
  source: Source
  path: string
  onNavigate: (source: Source, path: string) => void
  other: { source: Source; path: string } | null
  compare: Map<string, CompareState> | null
  active: boolean
  onFocus: () => void
  reloadKey: number
  onSelection: (items: FileEntry[]) => void
}

function SourcePicker({ value, onChange }: { value: Source; onChange: (s: Source) => void }) {
  const sites = useStore(s => s.sites).filter(s => s.type !== 'telnet')
  const local = useStore(s => s.caps?.localShell)
  return (
    <select className="select sm" value={String(value)} onChange={(e) => onChange(e.target.value === 'local' ? 'local' : Number(e.target.value))}>
      {local && <option value="local">💻 Local</option>}
      {sites.map(s => <option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}
    </select>
  )
}

function Pane({ side, source, path, onNavigate, other, compare, active, onFocus, reloadKey, onSelection }: PaneProps) {
  const [items, setItems] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: 'name' | 'size' | 'modified'; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [dropHover, setDropHover] = useState(false)
  const [history, setHistory] = useState<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] })
  const [pathInput, setPathInput] = useState(path)
  const toast = useStore(s => s.toast)
  const caps = siteById(typeof source === 'number' ? source : null)

  const load = useCallback(async () => {
    if (!path) return
    setLoading(true); setError(null)
    try {
      setItems(await withHostKey(() => api.get<FileEntry[]>('/api/files/list', { source, path })))
      setSel(new Set())
    } catch (e: any) { setError(e.message); setItems([]) }
    finally { setLoading(false) }
  }, [source, path])

  useEffect(() => { load(); setPathInput(path) }, [load, reloadKey])
  useEffect(() => { onSelection(items.filter(i => sel.has(i.path))) }, [sel, items])

  const visible = useMemo(() => {
    const f = filter.toLowerCase()
    return items.filter(i => !f || i.name.toLowerCase().includes(f)).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      const k = sort.key
      const va = (a as any)[k] ?? 0, vb = (b as any)[k] ?? 0
      return (k === 'name' ? String(va).localeCompare(String(vb), undefined, { numeric: true }) : va - vb) * sort.dir
    })
  }, [items, filter, sort])

  const go = (p: string) => { setHistory(h => ({ back: [...h.back, path], fwd: [] })); onNavigate(source, p) }
  const back = () => { const p = history.back.at(-1); if (!p) return; setHistory(h => ({ back: h.back.slice(0, -1), fwd: [path, ...h.fwd] })); onNavigate(source, p) }
  const fwd = () => { const p = history.fwd[0]; if (!p) return; setHistory(h => ({ back: [...h.back, path], fwd: h.fwd.slice(1) })); onNavigate(source, p) }
  const home = async () => { try { const r = await withHostKey(() => api.get('/api/files/home', { source })); go(r.path) } catch (e: any) { toast(e.message, 'error') } }

  const selected = () => items.filter(i => sel.has(i.path))

  const click = (e: React.MouseEvent, item: FileEntry) => {
    onFocus()
    const next = new Set(e.metaKey || e.ctrlKey ? sel : [])
    if (e.shiftKey && anchor) {
      const a = visible.findIndex(i => i.path === anchor), b = visible.findIndex(i => i.path === item.path)
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(visible[i].path)
    } else if ((e.metaKey || e.ctrlKey) && sel.has(item.path)) next.delete(item.path)
    else { next.add(item.path); setAnchor(item.path) }
    setSel(next)
  }

  const open = (item: FileEntry) => item.isDir ? go(item.path) : openEditor(source, item.path)

  const ops = {
    mkdir: async () => { const n = await askText('New folder', '', 'folder name'); if (!n) return; try { await api.post('/api/files/mkdir', { source, path: join(path, n) }); load() } catch (e: any) { toast(e.message, 'error') } },
    touch: async () => { const n = await askText('New file', '', 'file name'); if (!n) return; try { await api.post('/api/files/touch', { source, path: join(path, n) }); load(); openEditor(source, join(path, n)) } catch (e: any) { toast(e.message, 'error') } },
    rename: async (it: FileEntry) => { const n = await askText('Rename', it.name); if (!n || n === it.name) return; try { await api.post('/api/files/rename', { source, from: it.path, to: join(parent(it.path), n) }); load() } catch (e: any) { toast(e.message, 'error') } },
    remove: async (list: FileEntry[]) => {
      if (!list.length || !(await askConfirm(`Delete ${list.length === 1 ? `"${list[0].name}"` : `${list.length} items`}?`, 'This cannot be undone.', true))) return
      try { await api.post('/api/files/delete', { source, items: list.map(i => ({ path: i.path, isDir: i.isDir })) }); load() } catch (e: any) { toast(e.message, 'error'); load() }
    },
    chmod: async (it: FileEntry) => { const m = await askText(`Permissions for ${it.name} (octal)`, it.mode ? it.mode.toString(8) : '644'); if (!m) return; try { await api.post('/api/files/chmod', { source, path: it.path, mode: m }); load() } catch (e: any) { toast(e.message, 'error') } },
    send: (list: FileEntry[], mode: 'copy' | 'move') => { if (other) startTransfer(list, source, other.source, other.path, mode) },
  }

  const contextMenu = (e: React.MouseEvent, item?: FileEntry) => {
    e.preventDefault(); onFocus()
    let list = selected()
    if (item && !sel.has(item.path)) { setSel(new Set([item.path])); list = [item] }
    const isShell = source === 'local' || ['ssh', 'sftp', 'scp'].includes(caps?.type ?? '')
    const dir = item?.isDir ? item.path : path
    const its: MenuItem[] = []
    if (item) {
      its.push({ label: item.isDir ? 'Open' : 'Edit', icon: item.isDir ? <Folder size={14} /> : <Pencil size={14} />, onClick: () => open(item) })
      if (!item.isDir) its.push({ label: 'Download', icon: <Download size={14} />, onClick: () => list.filter(i => !i.isDir).forEach(i => downloadFile(source, i.path)) })
      if (other) {
        its.push({ label: `Copy to ${side === 'left' ? 'right' : 'left'} (${sourceLabel(other.source)})`, icon: <Copy size={14} />, onClick: () => ops.send(list, 'copy') })
        its.push({ label: `Move to ${side === 'left' ? 'right' : 'left'}`, icon: <Move size={14} />, onClick: () => ops.send(list, 'move') })
      }
      its.push({ separator: true })
      its.push({ label: 'Rename…', icon: <Pencil size={14} />, onClick: () => ops.rename(item) })
      if (source === 'local' || caps?.type !== 's3') its.push({ label: 'Permissions…', icon: <KeyRound size={14} />, onClick: () => ops.chmod(item) })
      its.push({ label: 'Copy path', icon: <Link size={14} />, onClick: () => navigator.clipboard.writeText(list.map(i => i.path).join('\n')) })
      its.push({ label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => ops.remove(list) })
      its.push({ separator: true })
    }
    its.push({ label: 'New folder…', icon: <FolderPlus size={14} />, onClick: ops.mkdir })
    its.push({ label: 'New file…', icon: <FilePlus size={14} />, onClick: ops.touch })
    if (isShell) {
      its.push({ separator: true })
      its.push({ label: 'Open terminal here', icon: <SquareTerminal size={14} />, onClick: () => openTerminal({ kind: source === 'local' ? 'local' : 'ssh', connectionId: source === 'local' ? null : source, cwd: dir }) })
      const agents = useStore.getState().caps?.agents.filter(a => a.id !== 'shell') || []
      for (const a of agents) its.push({ label: `Open ${a.label} here`, icon: <Sparkles size={14} />, onClick: () => openTerminal({ kind: source === 'local' ? 'local' : 'ssh', connectionId: source === 'local' ? null : source, cwd: dir, agent: a.id }) })
      its.push({ label: 'AI workspace for this folder…', icon: <Sparkles size={14} />, onClick: () => {
        const ws = useStore.getState().workspaces.find(w => (w.connection_id ?? 'local') === (source === 'local' ? 'local' : source) && w.path === dir)
        openWorkspace(ws ? ws.id : 'new', { connection_id: source === 'local' ? null : source, path: dir })
      } })
    }
    its.push({ separator: true }, { label: 'Refresh', icon: <RefreshCw size={14} />, onClick: load })
    setMenu({ x: e.clientX, y: e.clientY, items: its })
  }

  const onDragStart = (e: React.DragEvent, item: FileEntry) => {
    let list = selected()
    if (!sel.has(item.path)) { list = [item]; setSel(new Set([item.path])) }
    e.dataTransfer.setData('application/x-cfh-files', JSON.stringify(list.map(i => ({ path: i.path }))))
    e.dataTransfer.setData('application/x-cfh-transfer', JSON.stringify({ source, items: list }))
    e.dataTransfer.setData('text/plain', list.map(i => i.path).join('\n'))
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  const onDrop = async (e: React.DragEvent, targetDir = path) => {
    e.preventDefault(); e.stopPropagation(); setDropHover(false)
    const t = e.dataTransfer.getData('application/x-cfh-transfer')
    if (t) {
      const { source: from, items: list } = JSON.parse(t)
      if (from === source && list.every((i: FileEntry) => parent(i.path) === targetDir)) return
      startTransfer(list, from, source, targetDir, e.altKey || e.shiftKey ? 'move' : 'copy')
      return
    }
    if (e.dataTransfer.files.length) uploadFiles(await filesFromDrop(e.dataTransfer), source, targetDir, load)
  }

  const crumbs = useMemo(() => {
    const win = /^[A-Za-z]:\\/.test(path)
    const parts = path.split(/[\\/]/).filter(Boolean)
    return parts.map((p, i) => ({ name: p, path: win ? parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '') : '/' + parts.slice(0, i + 1).join('/') }))
  }, [path])

  const cmpClass = (name: string) => {
    const s = compare?.get(name)
    if (!s || s === 'same') return s ? 'cmp-same' : ''
    if ((s === 'only-left' && side === 'left') || (s === 'only-right' && side === 'right')) return 'cmp-only'
    if ((s === 'newer-left' && side === 'left') || (s === 'newer-right' && side === 'right')) return 'cmp-newer'
    if (s === 'only-left' || s === 'only-right') return 'cmp-missing'
    return 'cmp-diff'
  }

  return (
    <div className={`pane${active ? ' active' : ''}${dropHover ? ' drop' : ''}`} onMouseDown={onFocus}
      onDragOver={(e) => { e.preventDefault(); setDropHover(true) }} onDragLeave={() => setDropHover(false)} onDrop={(e) => onDrop(e)}>
      <div className="pane-bar">
        <SourcePicker value={source} onChange={(s) => { setHistory({ back: [], fwd: [] }); onNavigate(s, '') }} />
        <button className="icon-btn" title="Back" disabled={!history.back.length} onClick={back}><ArrowLeft size={14} /></button>
        <button className="icon-btn" title="Forward" disabled={!history.fwd.length} onClick={fwd}><ArrowRight size={14} /></button>
        <button className="icon-btn" title="Up" onClick={() => go(parent(path))}><ArrowUp size={14} /></button>
        <button className="icon-btn" title="Home" onClick={home}><Home size={14} /></button>
        <button className="icon-btn" title="Refresh" onClick={load}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
        <input className="input sm filter" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <form className="pane-path" onSubmit={(e) => { e.preventDefault(); go(pathInput) }}>
        <div className="crumbs" onClick={(e) => { if (e.target === e.currentTarget) (e.currentTarget.nextSibling as HTMLInputElement)?.focus() }}>
          <button type="button" className="crumb" onClick={() => go(/^[A-Za-z]:\\/.test(path) ? path.slice(0, 3) : '/')}>/</button>
          {crumbs.map(c => <button type="button" key={c.path} className="crumb" onClick={() => go(c.path)}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, c.path)}>{c.name}</button>)}
        </div>
        <input className="path-input" value={pathInput} onChange={(e) => setPathInput(e.target.value)} />
      </form>
      <div className="file-list" onContextMenu={(e) => contextMenu(e)} tabIndex={0}
        onKeyDown={(e) => {
          const list = selected()
          if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) ops.remove(list)
          else if (e.key === 'Enter' && list[0]) open(list[0])
          else if (e.key === 'Backspace') go(parent(path))
          else if (e.key === 'F2' && list[0]) ops.rename(list[0])
          else if (e.key === 'F5' && other) ops.send(list, 'copy')
          else if (e.key === 'F6' && other) ops.send(list, 'move')
          else if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); setSel(new Set(visible.map(i => i.path))) }
        }}>
        <div className="file-row head">
          {(['name', 'size', 'modified'] as const).map(k => (
            <span key={k} className={`col-${k}`} onClick={() => setSort(s => ({ key: k, dir: s.key === k ? (s.dir * -1) as 1 | -1 : 1 }))}>
              {k[0].toUpperCase() + k.slice(1)}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
            </span>
          ))}
          <span className="col-mode">Perms</span>
        </div>
        {error && <div className="pane-error">{error}</div>}
        {visible.map(item => (
          <div key={item.path} className={`file-row${sel.has(item.path) ? ' sel' : ''} ${cmpClass(item.name)}`} draggable
            onDragStart={(e) => onDragStart(e, item)} onClick={(e) => click(e, item)} onDoubleClick={() => open(item)}
            onContextMenu={(e) => { e.stopPropagation(); contextMenu(e, item) }}
            onDragOver={item.isDir ? (e) => { e.preventDefault(); e.stopPropagation() } : undefined}
            onDrop={item.isDir ? (e) => onDrop(e, item.path) : undefined}>
            <span className="col-name">{item.isDir ? <Folder size={14} className="ic-dir" /> : <File size={14} className="ic-file" />}<span>{item.name}</span>{item.isLink && <span className="muted"> ↪</span>}</span>
            <span className="col-size">{item.isDir ? '' : formatBytes(item.size)}</span>
            <span className="col-modified">{formatDate(item.modified)}</span>
            <span className="col-mode mono">{modeStr(item.mode)}</span>
          </div>
        ))}
        {!loading && !error && !visible.length && <div className="pane-empty muted">Empty folder — drop files here to upload</div>}
      </div>
      <div className="pane-status muted">{items.length} items{sel.size ? ` · ${sel.size} selected (${formatBytes(selected().reduce((a, i) => a + (i.isDir ? 0 : i.size), 0))})` : ''}</div>
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

interface FilesParams { left: Source; leftPath?: string; right?: Source | null; rightPath?: string }

export function FilesPanel(props: IDockviewPanelProps<FilesParams>) {
  const p = props.params
  const [left, setLeft] = useState({ source: p.left, path: p.leftPath || '' })
  const [right, setRight] = useState<{ source: Source; path: string } | null>(p.right !== undefined && p.right !== null ? { source: p.right, path: p.rightPath || '' } : null)
  const [active, setActive] = useState<'left' | 'right'>('left')
  const [compare, setCompare] = useState<Map<string, CompareState> | null>(null)
  const [reload, setReload] = useState({ left: 0, right: 0 })
  const [selection, setSelection] = useState<{ left: FileEntry[]; right: FileEntry[] }>({ left: [], right: [] })
  const policy = useStore(s => s.config.transfers.policy)
  const transfers = useStore(s => s.transfers)
  const toast = useStore(s => s.toast)

  // Resolve empty paths to the source's home folder.
  useEffect(() => { if (!left.path) withHostKey(() => api.get('/api/files/home', { source: left.source })).then(r => setLeft(l => ({ ...l, path: r.path }))).catch(e => toast(e.message, 'error')) }, [left.source, left.path])
  useEffect(() => { if (right && !right.path) withHostKey(() => api.get('/api/files/home', { source: right.source })).then(r => setRight(x => x && ({ ...x, path: r.path }))).catch(e => toast(e.message, 'error')) }, [right?.source, right?.path])

  useEffect(() => {
    props.api.updateParameters({ left: left.source, leftPath: left.path, right: right?.source ?? null, rightPath: right?.path, title: 'Files' })
    const label = right ? `${sourceLabel(left.source)} ⇄ ${sourceLabel(right.source)}` : sourceLabel(left.source)
    props.api.setTitle(label)
    setCompare(null)
  }, [left.source, left.path, right?.source, right?.path])

  // Refresh panes when a transfer into them finishes.
  const lastDone = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const t of transfers) {
      if (t.status !== 'done' && t.status !== 'failed') continue
      if (lastDone.current.has(t.id)) continue
      lastDone.current.add(t.id)
      if (t.dst === left.source && t.dstDir === left.path) setReload(r => ({ ...r, left: r.left + 1 }))
      if (right && t.dst === right.source && t.dstDir === right.path) setReload(r => ({ ...r, right: r.right + 1 }))
      if (t.mode === 'move') setReload(r => ({ left: r.left + 1, right: r.right + 1 }))
    }
  }, [transfers])

  const runCompare = async () => {
    if (!right) return
    try {
      const rows = await api.post<{ name: string; state: CompareState }[]>('/api/transfers/compare', { left, right })
      setCompare(new Map(rows.map(r => [r.name, r.state])))
      const diff = rows.filter(r => r.state !== 'same').length
      toast(diff ? `${diff} difference(s)` : 'Folders are identical', diff ? 'info' : 'success')
    } catch (e: any) { toast(e.message, 'error') }
  }

  const sync = async (dir: 'ltr' | 'rtl') => {
    if (!right || !compare) return
    const [from, to] = dir === 'ltr' ? [left, right] : [right, left]
    const wanted: CompareState[] = dir === 'ltr' ? ['only-left', 'newer-left', 'different'] : ['only-right', 'newer-right', 'different']
    const list = await api.get<FileEntry[]>('/api/files/list', { source: from.source, path: from.path })
    const items = list.filter(i => wanted.includes(compare.get(i.name)!))
    if (!items.length) return toast('Nothing to sync')
    startTransfer(items, from.source, to.source, to.path, 'copy', 'newer')
  }

  const send = (from: 'left' | 'right', mode: 'copy' | 'move') => {
    const src = from === 'left' ? left : right
    const dst = from === 'left' ? right : left
    if (!src || !dst) return
    const items = selection[from]
    if (!items.length) return toast('Select files first')
    startTransfer(items, src.source, dst.source, dst.path, mode)
  }

  const setPolicy = (v: string) => { const st = useStore.getState(); st.saveConfig({ ...st.userConfig, transfers: { ...st.config.transfers, policy: v } }) }

  return (
    <div className="files-panel">
      <div className="files-toolbar">
        <button className="btn sm" title="Toggle second pane" onClick={() => setRight(r => r ? null : { source: left.source === 'local' ? (useStore.getState().sites[0]?.id ?? 'local') : 'local', path: '' })}><Columns2 size={14} /> {right ? 'Single' : 'Dual pane'}</button>
        {right && <>
          <button className="btn sm" title="Copy selection → (F5)" onClick={() => send(active, 'copy')}><Copy size={14} /> Copy {active === 'left' ? '→' : '←'}</button>
          <button className="btn sm" title="Move selection (F6)" onClick={() => send(active, 'move')}><Scissors size={14} /> Move {active === 'left' ? '→' : '←'}</button>
          <button className="btn sm" title="Compare folders" onClick={runCompare}><GitCompare size={14} /> Compare</button>
          {compare && <>
            <button className="btn sm" title="Copy missing/newer files left → right" onClick={() => sync('ltr')}>Sync →</button>
            <button className="btn sm" title="Copy missing/newer files right → left" onClick={() => sync('rtl')}>← Sync</button>
          </>}
        </>}
        <span className="spacer" />
        <label className="muted sm">If exists:</label>
        <select className="select sm" value={policy} onChange={(e) => setPolicy(e.target.value)}>
          {Object.entries(POLICY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="btn sm" title="Upload files"><Upload size={14} /> Upload
          <input type="file" multiple hidden onChange={(e) => {
            const target = active === 'right' && right ? right : left
            const files = [...(e.target.files || [])].map(f => ({ file: f, rel: f.name }))
            uploadFiles(files, target.source, target.path, () => setReload(r => ({ ...r, [active]: r[active] + 1 })))
            e.target.value = ''
          }} />
        </label>
      </div>
      <div className={`panes${right ? ' dual' : ''}`}>
        <Pane side="left" {...left} other={right} compare={compare} active={active === 'left'} onFocus={() => setActive('left')}
          reloadKey={reload.left} onNavigate={(source, path) => setLeft({ source, path })} onSelection={(items) => setSelection(s => ({ ...s, left: items }))} />
        {right && <Pane side="right" {...right} other={left} compare={compare} active={active === 'right'} onFocus={() => setActive('right')}
          reloadKey={reload.right} onNavigate={(source, path) => setRight({ source, path })} onSelection={(items) => setSelection(s => ({ ...s, right: items }))} />}
      </div>
    </div>
  )
}
