import { useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewReadyEvent, type IWatermarkPanelProps, type DockviewTheme } from 'dockview-react'
import { Plus, Server, FolderTree, Sparkles } from 'lucide-react'
import { api, setUnauthorizedHandler, wsUrl } from './api'
import { useStore } from './store'
import { setDock, getDock, newLocalTerminal, openFiles } from './layout'
import { TerminalPanel } from './panels/TerminalPanel'
import { EditorPanel } from './panels/EditorPanel'
import { FilesPanel } from './panels/FilesPanel'
import { SettingsPanel } from './panels/SettingsPanel'
import { TransfersPanel } from './panels/TransfersPanel'
import { WorkspacePanel } from './panels/WorkspacePanel'
import { Tab } from './components/Tab'
import { RightHeaderActions } from './components/HeaderActions'
import { Sidebar } from './sidebar/Sidebar'
import { Login } from './Login'
import { PromptHost } from './dialogs/Prompt'
import { SiteDialog } from './dialogs/SiteDialog'
import { HostKeyDialog } from './dialogs/HostKeyDialog'
import { CommandPalette } from './dialogs/CommandPalette'
import { keyBindings, runCommand } from './commands'
import { detectModStyle, eventToKey } from './config/keymap'
import type { TransferJob, User } from './types'

const hyperDock: DockviewTheme = { name: 'hyper', className: 'dockview-theme-hyper', gap: 0, dndOverlayMounting: 'absolute', dndPanelOverlay: 'group', tabAnimation: 'smooth' }

const components = { terminal: TerminalPanel, editor: EditorPanel, files: FilesPanel, settings: SettingsPanel, transfers: TransfersPanel, workspace: WorkspacePanel }
const desktop = (window as any).cfhDesktop as { platform: string } | undefined

function Welcome(_: IWatermarkPanelProps) {
  const caps = useStore(s => s.caps)
  return (
    <div className="welcome">
      <div className="welcome-logo">&gt;_</div>
      <div className="welcome-actions">
        {caps?.localShell && <button className="btn" onClick={() => newLocalTerminal('tab', 'shell')}><Plus size={14} /> New terminal</button>}
        {caps?.localShell && caps.agents.filter(a => a.id !== 'shell').map(a => <button key={a.id} className="btn" onClick={() => newLocalTerminal('tab', a.id)}><Sparkles size={14} /> {a.label}</button>)}
        <button className="btn" onClick={() => useStore.getState().set({ paletteOpen: true })}><Server size={14} /> Connect to a site</button>
        <button className="btn" onClick={() => openFiles()}><FolderTree size={14} /> File manager</button>
      </div>
      <p className="muted sm">Drag tabs to split the window into a grid. Everything keeps running on the server when you close this window.</p>
    </div>
  )
}

function Toasts() {
  const toasts = useStore(s => s.toasts)
  return <div className="toasts">{toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
}

function Workbench() {
  const theme = useStore(s => s.theme)
  const config = useStore(s => s.config)
  const { paletteOpen, siteDialog, hostKeyPrompt } = useStore()
  const saveTimer = useRef<number | null>(null)

  const onReady = async (e: DockviewReadyEvent) => {
    setDock(e.api)
    let restored = false
    try {
      const prefs = await api.get('/api/prefs')
      const layout = prefs.layout || JSON.parse(localStorage.getItem('cfh.layout') || 'null')
      if (layout?.grid) { e.api.fromJSON(layout); restored = e.api.panels.length > 0 }
    } catch (err) { console.warn('Could not restore layout', err); e.api.clear() }
    if (!restored && useStore.getState().caps?.localShell) newLocalTerminal('tab', 'shell')
    e.api.onDidLayoutChange(() => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        const json = e.api.toJSON()
        localStorage.setItem('cfh.layout', JSON.stringify(json))
        api.put('/api/prefs/layout', json).catch(() => {})
      }, 800)
    })
  }

  // Global shortcuts (capture phase, so they win over xterm and Monaco).
  useEffect(() => {
    const style = detectModStyle(!!desktop)
    const onKey = (e: KeyboardEvent) => {
      const key = eventToKey(e, style)
      if (!key) return
      const cmd = keyBindings().get(key)
      if (!cmd) return
      e.preventDefault(); e.stopPropagation()
      runCommand(cmd)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [config.keymap])

  // Live transfer progress.
  useEffect(() => {
    let ws: WebSocket | null = null, stop = false, t: number
    const connect = () => {
      ws = new WebSocket(wsUrl('/ws/transfers'))
      ws.onmessage = (m) => {
        const job: TransferJob = JSON.parse(m.data)
        const list = useStore.getState().transfers
        const i = list.findIndex(j => j.id === job.id)
        const next = i >= 0 ? list.map(j => j.id === job.id ? job : j) : [job, ...list]
        useStore.getState().set({ transfers: next })
        if (job.status === 'done' && (i < 0 || list[i].status !== 'done')) useStore.getState().toast(`Transfer finished: ${job.label}`, 'success')
        if (job.status === 'failed' && (i < 0 || list[i].status !== 'failed')) useStore.getState().toast(`Transfer failed: ${job.label} — ${job.error}`, 'error')
      }
      ws.onclose = () => { if (!stop) t = window.setTimeout(connect, 3000) }
    }
    connect()
    return () => { stop = true; clearTimeout(t); ws?.close() }
  }, [])

  const vars = {
    '--term-bg': theme.background, '--fg': theme.foreground, '--border': theme.border, '--tab-bg': theme.tabBg,
    '--tab-active-bg': theme.tabActiveBg, '--tab-fg': theme.tabFg, '--tab-active-fg': theme.tabActiveFg,
    '--sidebar-bg': theme.sidebarBg, '--accent': theme.accent, '--selection': theme.selection, '--font-mono': config.fontFamily,
  } as React.CSSProperties

  return (
    <div className={`app ${theme.type}${desktop ? ` desktop ${desktop.platform}` : ''}${config.backgroundOpacity < 1 ? ' translucent' : ''}`} style={vars}>
      {desktop?.platform === 'darwin' && <div className="titlebar-drag" />}
      <Sidebar />
      <main className="dock-host">
        <DockviewReact
          className={`dock tabs-${config.tabs.position}`}
          theme={hyperDock}
          components={components}
          tabComponents={{ tab: Tab }}
          defaultTabComponent={Tab}
          rightHeaderActionsComponent={RightHeaderActions}
          watermarkComponent={Welcome}
          defaultRenderer="always"
          singleTabMode="default"
          defaultHeaderPosition={config.tabs.position}
          onReady={onReady}
        />
      </main>
      {paletteOpen && <CommandPalette />}
      {siteDialog && <SiteDialog />}
      {hostKeyPrompt && <HostKeyDialog />}
      <PromptHost />
      <Toasts />
    </div>
  )
}

export function App() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready'>('loading')
  const set = useStore(s => s.set)
  const boot = async (user: User) => {
    set({ user })
    await useStore.getState().loadAll()
    setPhase('ready')
  }
  useEffect(() => {
    setUnauthorizedHandler(() => setPhase('login'))
    api.get<User>('/api/auth/me').then(boot).catch(() => setPhase('login'))
  }, [])
  if (phase === 'loading') return <div className="boot">&gt;_</div>
  if (phase === 'login') return <Login onLogin={boot} />
  return <Workbench />
}
