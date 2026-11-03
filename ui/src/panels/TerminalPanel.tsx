import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { TermController } from '../terminal/TermController'
import { controllers, useTabState, beep, notify } from '../terminal/registry'
import { useStore } from '../store'
import type { TerminalParams } from '../types'
import { TermContextMenu } from '../components/TermContextMenu'
import { SearchBar } from '../components/SearchBar'

export function TerminalPanel(props: IDockviewPanelProps<TerminalParams>) {
  const hostRef = useRef<HTMLDivElement>(null)
  const ctrlRef = useRef<TermController | null>(null)
  const config = useStore(s => s.config)
  const theme = useStore(s => s.theme)
  const patch = useTabState(s => s.patch)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [searching, setSearching] = useState(false)
  const id = props.api.id

  useEffect(() => {
    const host = hostRef.current!
    const ctrl = new TermController(host, props.params, useStore.getState().config, useStore.getState().theme, {
      onParams: (p) => props.api.updateParameters({ ...props.params, ...p }),
      onTitle: (t) => { props.api.setTitle(t); props.api.updateParameters({ ...props.params, title: t }) },
      onStatus: (status) => patch(id, { status }),
      onActivity: () => patch(id, { activity: true }),
      onCwd: (cwd) => { if (props.api.isActive) useStore.getState().set({ context: { source: props.params.kind === 'local' ? 'local' : props.params.connectionId!, cwd } }) },
      onBell: () => {
        const cfg = useStore.getState().config
        if (cfg.bell === 'sound') beep()
        if (!props.api.isActive || document.hidden) {
          patch(id, { bell: true })
          if (cfg.notifications.onBell) notify(props.api.title || 'Terminal', 'Bell', () => props.api.setActive())
        } else if (cfg.bell === 'visual') {
          host.classList.add('bell-flash'); setTimeout(() => host.classList.remove('bell-flash'), 150)
        }
      },
      onNotify: (title, body) => {
        patch(id, { bell: !props.api.isActive })
        if (!props.api.isActive || document.hidden) notify(title || props.api.title || 'Terminal', body, () => props.api.setActive())
      },
      onAgentIdle: () => {
        if (props.api.isActive && !document.hidden) return
        patch(id, { waiting: true })
        notify(props.api.title || 'Agent', 'Waiting for your input', () => props.api.setActive())
      },
    })
    ctrlRef.current = ctrl
    controllers.set(id, ctrl)
    if (props.params.title) ctrl.setUserTitle(false)

    const subs = [
      props.api.onDidActiveChange(({ isActive }) => {
        if (isActive) {
          patch(id, { activity: false, bell: false, waiting: false })
          ctrl.focus()
          const p = props.params
          useStore.getState().set({ context: { source: p.kind === 'local' ? 'local' : p.connectionId!, cwd: p.cwd ?? null } })
        }
      }),
      props.api.onDidVisibilityChange(({ isVisible }) => { ctrl.visible = isVisible; if (isVisible) ctrl.scheduleFit() }),
      props.api.onDidDimensionsChange(() => ctrl.scheduleFit()),
    ]
    const onFind = (e: Event) => { if ((e as CustomEvent).detail === id) setSearching(true) }
    window.addEventListener('cfh:find', onFind)
    subs.push({ dispose: () => window.removeEventListener('cfh:find', onFind) })
    if (props.api.isActive) setTimeout(() => ctrl.focus(), 50)
    return () => { subs.forEach(s => s.dispose()); controllers.delete(id); ctrl.dispose() }
  }, [])

  useEffect(() => { ctrlRef.current?.applyConfig(config, theme) }, [config, theme])

  // Drop files from the explorer (or the OS) to type their paths — handy for agents.
  const onDrop = (e: React.DragEvent) => {
    const data = e.dataTransfer.getData('application/x-cfh-files')
    if (!data) return
    e.preventDefault()
    const items: { path: string }[] = JSON.parse(data)
    ctrlRef.current?.paste(items.map(i => (/[\s'"$`\\]/.test(i.path) ? `'${i.path.replace(/'/g, `'\\''`)}'` : i.path)).join(' ') + ' ')
    ctrlRef.current?.focus()
  }

  return (
    <div className="term-panel" style={{ padding: config.padding, background: 'var(--term-bg)' }}
      onContextMenu={(e) => {
        if (config.rightClick === 'menu') { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }
        else if (config.rightClick === 'paste') { e.preventDefault(); navigator.clipboard.readText().then(t => ctrlRef.current?.paste(t)) }
      }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-cfh-files')) e.preventDefault() }}
      onDrop={onDrop}>
      <div ref={hostRef} className="term-host" />
      {searching && ctrlRef.current && <SearchBar ctrl={ctrlRef.current} onClose={() => { setSearching(false); ctrlRef.current?.focus() }} />}
      {menu && ctrlRef.current && (
        <TermContextMenu x={menu.x} y={menu.y} ctrl={ctrlRef.current} panel={props.api} params={props.params}
          onSearch={() => setSearching(true)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
