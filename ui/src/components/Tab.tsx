import { useEffect, useState } from 'react'
import type { IDockviewPanelHeaderProps } from 'dockview'
import { X } from 'lucide-react'
import { PanelIcon } from './Icons'
import { useTabState } from '../terminal/registry'
import { controllers } from '../terminal/registry'
import { closePanel } from '../commands'
import { useStore, siteById } from '../store'

export function Tab(props: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState(props.api.title || '')
  const [editing, setEditing] = useState(false)
  const st = useTabState(s => s.tabs[props.api.id]) || {}
  const showIcons = useStore(s => s.config.tabs.showIcons)
  const component = (props.api as any).component ?? props.containerApi.getPanel(props.api.id)?.view.contentComponent
  const site = props.params?.connectionId ? siteById(props.params.connectionId) : null

  useEffect(() => { const d = props.api.onDidTitleChange(e => setTitle(e.title)); return () => d.dispose() }, [])

  const busy = st.status === 'connecting' || st.status === 'reconnecting'
  const dead = st.status === 'exited' || st.status === 'error'

  return (
    <div className={`hy-tab${dead ? ' dead' : ''}${st.waiting ? ' waiting' : ''}`}
      onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closePanel(props.api.id) } }}
      onDoubleClick={() => setEditing(true)}
      title={[title, site ? `${site.username ? site.username + '@' : ''}${site.host ?? site.bucket ?? ''}` : '', props.params?.cwd].filter(Boolean).join('\n')}>
      <button className="hy-tab-close" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); closePanel(props.api.id) }} aria-label="Close tab">
        <X size={12} />
      </button>
      {site?.color && <span className="hy-tab-color" style={{ background: site.color }} />}
      {showIcons && <span className="hy-tab-icon"><PanelIcon component={component} params={props.params} /></span>}
      {editing ? (
        <input className="hy-tab-edit" autoFocus defaultValue={title}
          onBlur={(e) => { setEditing(false); const v = e.target.value.trim(); if (v) { props.api.setTitle(v); controllers.get(props.api.id)?.setUserTitle(true); props.api.updateParameters({ ...props.params, title: v }) } }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false) }} />
      ) : <span className="hy-tab-title">{title}</span>}
      <span className="hy-tab-badges">
        {busy && <span className="badge spin" title={st.status} />}
        {st.waiting && <span className="badge waiting" title="Agent is waiting for you" />}
        {st.bell && <span className="badge bell" title="Bell / notification" />}
        {st.activity && !st.bell && !st.waiting && <span className="badge activity" title="New output" />}
        {st.dirty && <span className="badge dirty" title="Unsaved changes" />}
      </span>
    </div>
  )
}
