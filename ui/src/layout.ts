// Opening panels. Everything (terminals, editors, file manager, settings…) is
// a dockview panel, so any of them can be dragged into tabs or a grid.
import type { DockviewApi, IDockviewPanel } from 'dockview'
import type { Source, TerminalParams } from './types'
import { useStore, siteById } from './store'

let dock: DockviewApi | null = null
export const setDock = (api: DockviewApi) => { dock = api }
export const getDock = () => dock

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

type Where = 'tab' | 'right' | 'below' | 'float'

function position(where: Where = 'tab') {
  const active = dock?.activePanel
  if (!active) return undefined
  if (where === 'right') return { referencePanel: active, direction: 'right' as const }
  if (where === 'below') return { referencePanel: active, direction: 'below' as const }
  return { referenceGroup: active.group, direction: 'within' as const }
}

export function openTerminal(params: TerminalParams, where: Where = 'tab'): IDockviewPanel | undefined {
  if (!dock) return
  const site = params.connectionId ? siteById(params.connectionId) : null
  const title = params.title || (params.agent && params.agent !== 'shell'
    ? `${{ claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' }[params.agent]}${site ? ' · ' + site.name : ''}`
    : site?.name || 'Terminal')
  return dock.addPanel({
    id: uid('term'), component: 'terminal', tabComponent: 'tab', title,
    params: { ...params, title },
    position: position(where) as any,
    floating: where === 'float' ? { width: 700, height: 420 } : undefined,
  } as any)
}

export function newLocalTerminal(where: Where = 'tab', agent?: TerminalParams['agent']) {
  const { caps, context, config } = useStore.getState()
  const a = agent ?? config.newTab.agent
  if (caps?.localShell) {
    const cwd = context?.source === 'local' ? context.cwd : null
    return openTerminal({ kind: 'local', cwd, agent: a }, where)
  }
  // Web without local shell: open the site of the current context, if any.
  if (context && context.source !== 'local') return openSiteTerminal(context.source, where, a, context.cwd)
  useStore.getState().set({ sidebarTab: 'sites', sidebarVisible: true })
  useStore.getState().toast('Local shell is disabled on this server — pick a site to connect', 'info')
}

export function openSiteTerminal(siteId: number, where: Where = 'tab', agent: TerminalParams['agent'] = 'shell', cwd?: string | null) {
  const site = siteById(siteId)
  if (!site) return
  const kind = site.type === 'telnet' ? 'telnet' : ['ssh', 'sftp', 'scp'].includes(site.type) ? 'ssh' : null
  if (!kind) { openFiles({ left: 'local', right: siteId }); return }
  return openTerminal({ kind, connectionId: siteId, agent, cwd: cwd ?? null }, where)
}

/** Focuses an existing panel with the same key instead of opening a duplicate. */
function focusExisting(match: (p: IDockviewPanel) => boolean) {
  const found = dock?.panels.find(match)
  if (found) { found.api.setActive(); return found }
  return null
}

export function openEditor(source: Source, path: string, where: Where = 'tab') {
  if (!dock) return
  const existing = focusExisting(p => p.params?.source === source && p.params?.path === path && p.view.contentComponent === 'editor')
  if (existing) return existing
  const name = path.split(/[\\/]/).pop() || path
  return dock.addPanel({ id: uid('edit'), component: 'editor', tabComponent: 'tab', title: name, params: { source, path, title: name }, position: position(where) as any } as any)
}

export function openFiles(params: { left?: Source; leftPath?: string; right?: Source | null; rightPath?: string } = {}, where: Where = 'tab') {
  if (!dock) return
  const { caps } = useStore.getState()
  const left = params.left ?? (caps?.localShell ? 'local' : useStore.getState().sites[0]?.id ?? 'local')
  return dock.addPanel({ id: uid('files'), component: 'files', tabComponent: 'tab', title: 'Files', params: { ...params, left, title: 'Files' }, position: position(where) as any } as any)
}

function openSingleton(component: string, title: string, params: Record<string, any> = {}, where: Where = 'tab') {
  if (!dock) return
  const existing = focusExisting(p => p.view.contentComponent === component && (!params.key || p.params?.key === params.key))
  if (existing) { if (Object.keys(params).length) existing.api.updateParameters(params); return existing }
  return dock.addPanel({ id: uid(component), component, tabComponent: 'tab', title, params: { ...params, title }, position: position(where) as any } as any)
}

export const openSettings = (section?: string) => openSingleton('settings', 'Settings', section ? { section } : {})
export const openTransfers = () => openSingleton('transfers', 'Transfers')
export const openWorkspace = (workspaceId: number | 'new', defaults?: { connection_id?: number | null; path?: string }) =>
  openSingleton('workspace', workspaceId === 'new' ? 'New AI workspace' : 'AI workspace', { key: `ws-${workspaceId}`, workspaceId, defaults })

export function closeActive() { dock?.activePanel?.api.close() }

export function cycleTab(dir: 1 | -1) {
  const group = dock?.activeGroup
  if (!group) return
  const panels = group.panels
  const i = panels.findIndex(p => p.id === group.activePanel?.id)
  panels[(i + dir + panels.length) % panels.length]?.api.setActive()
}

export function gotoTab(n: number) {
  const panels = dock?.activeGroup?.panels
  if (!panels?.length) return
  panels[Math.min(n, panels.length) - 1]?.api.setActive()
}

/** Splits the active terminal: duplicates its connection in a new pane. */
export function splitActive(direction: 'right' | 'below') {
  const p = dock?.activePanel
  if (p?.view.contentComponent === 'terminal') {
    const { kind, connectionId, cwd } = p.params as TerminalParams
    return openTerminal({ kind, connectionId, cwd }, direction)
  }
  return newLocalTerminal(direction)
}

export function toggleMaximize() {
  const p = dock?.activePanel
  if (!p) return
  if (p.api.isMaximized()) p.api.exitMaximized(); else p.api.maximize()
}

/** Tiles every open panel into a grid (one group each). */
export function tileAll() {
  if (!dock) return
  const panels = [...dock.panels]
  if (panels.length < 2) return
  const cols = Math.ceil(Math.sqrt(panels.length))
  const first = panels[0]
  let rowStart = first
  panels.slice(1).forEach((p, i) => {
    const idx = i + 1
    if (idx % cols === 0) {
      p.api.moveTo({ group: rowStart.group, position: 'bottom' })
      rowStart = p
    } else {
      const prev = panels[idx - 1]
      p.api.moveTo({ group: prev.group, position: 'right' })
    }
  })
}

/** Stacks every panel as tabs of a single group. */
export function stackAll() {
  if (!dock) return
  const panels = [...dock.panels]
  const target = dock.activeGroup ?? panels[0]?.group
  if (!target) return
  for (const p of panels) if (p.group !== target) p.api.moveTo({ group: target, position: 'center' })
}
