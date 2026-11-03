import { useState } from 'react'
import type { IDockviewHeaderActionsProps } from 'dockview'
import { Plus, ChevronDown, Maximize2, Minimize2 } from 'lucide-react'
import { Menu, type MenuItem } from './Menu'
import { AgentIcon, SiteIcon } from './Icons'
import { useStore } from '../store'
import { newLocalTerminal, openSiteTerminal, openFiles, getDock } from '../layout'

export function newTabMenuItems(): MenuItem[] {
  const st = useStore.getState()
  const items: MenuItem[] = []
  if (st.caps?.localShell) {
    for (const a of st.caps.agents) items.push({ label: a.id === 'shell' ? 'Local shell' : a.label, icon: <AgentIcon agent={a.id} size={14} />, onClick: () => newLocalTerminal('tab', a.id) })
  }
  const recent = [...st.sites].filter(s => ['ssh', 'sftp', 'scp', 'telnet'].includes(s.type))
    .sort((a, b) => (b.last_connected || '').localeCompare(a.last_connected || '')).slice(0, 8)
  if (recent.length) {
    items.push({ separator: true })
    for (const s of recent) items.push({
      label: s.name, icon: <SiteIcon type={s.type} />, hint: s.type.toUpperCase(),
      onClick: () => openSiteTerminal(s.id),
      children: st.caps?.agents.filter(a => a.id !== 'shell').length ? [
        { label: 'Shell', icon: <AgentIcon agent="shell" size={14} />, onClick: () => openSiteTerminal(s.id) },
        ...st.caps!.agents.filter(a => a.id !== 'shell').map(a => ({ label: `${a.label} on ${s.name}`, icon: <AgentIcon agent={a.id} size={14} />, onClick: () => openSiteTerminal(s.id, 'tab', a.id) })),
      ] : undefined,
    })
  }
  items.push({ separator: true }, { label: 'File manager', onClick: () => openFiles() }, { label: 'New site…', onClick: () => st.set({ siteDialog: { site: null } }) })
  return items
}

export function RightHeaderActions(props: IDockviewHeaderActionsProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const maximized = props.api.isMaximized()
  return (
    <div className="hy-actions">
      <button title="New terminal" onClick={() => { props.activePanel?.api.setActive(); newLocalTerminal('tab') }}><Plus size={14} /></button>
      <button title="More…" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom }) }}><ChevronDown size={14} /></button>
      {getDock() && getDock()!.groups.length > 1 && (
        <button title={maximized ? 'Restore' : 'Maximize group'} onClick={() => maximized ? props.api.exitMaximized() : props.api.maximize()}>
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={newTabMenuItems()} onClose={() => setMenu(null)} />}
    </div>
  )
}
