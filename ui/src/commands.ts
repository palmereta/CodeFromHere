import { getDock, newLocalTerminal, openFiles, openSettings, openTransfers, splitActive, toggleMaximize, cycleTab, gotoTab, tileAll, stackAll, openWorkspace } from './layout'
import { controllers, useTabState } from './terminal/registry'
import { useStore } from './store'
import { defaultKeys, detectModStyle } from './config/keymap'
import { api } from './api'

export interface Command { id: string; label: string; group: string; run: () => void; when?: () => boolean }

/** Closing a terminal tab ends its server session (detaching only happens on reload). */
export async function closeTerminal(panelId: string) {
  const dock = getDock()
  const panel = dock?.getPanel(panelId)
  const ctrl = controllers.get(panelId)
  controllers.delete(panelId)
  useTabState.getState().clear(panelId)
  if (ctrl) await ctrl.kill()
  else if (panel?.params?.sessionId) await api.del(`/api/sessions/${panel.params.sessionId}`).catch(() => {})
  panel?.api.close()
}

export async function closePanel(panelId?: string) {
  const dock = getDock()
  const panel = panelId ? dock?.getPanel(panelId) : dock?.activePanel
  if (!panel) return
  if (panel.view.contentComponent === 'terminal') return closeTerminal(panel.id)
  if (useTabState.getState().tabs[panel.id]?.dirty && !confirm(`"${panel.title}" has unsaved changes. Close anyway?`)) return
  useTabState.getState().clear(panel.id)
  panel.api.close()
}

const activeCtrl = () => { const id = getDock()?.activePanel?.id; return id ? controllers.get(id) : undefined }

function fontDelta(d: number | 0) {
  const st = useStore.getState()
  const size = d === 0 ? 13 : st.config.fontSize + d
  st.saveConfig({ ...st.userConfig, fontSize: size })
}

export function getCommands(): Command[] {
  const st = useStore.getState()
  const agents: Command[] = (st.caps?.agents || []).filter(a => a.id !== 'shell').map(a => ({
    id: `agent.${a.id}`, label: `New ${a.label} tab`, group: 'AI', run: () => newLocalTerminal('tab', a.id),
  }))
  return [
    { id: 'tab.new', label: 'New terminal tab', group: 'Terminal', run: () => newLocalTerminal('tab') },
    { id: 'tab.close', label: 'Close tab', group: 'Terminal', run: () => closePanel() },
    { id: 'tab.next', label: 'Next tab', group: 'Terminal', run: () => cycleTab(1) },
    { id: 'tab.prev', label: 'Previous tab', group: 'Terminal', run: () => cycleTab(-1) },
    { id: 'split.right', label: 'Split right', group: 'Layout', run: () => splitActive('right') },
    { id: 'split.down', label: 'Split down', group: 'Layout', run: () => splitActive('below') },
    { id: 'panel.maximize', label: 'Maximize / restore panel', group: 'Layout', run: toggleMaximize },
    { id: 'layout.tile', label: 'Tile all panels in a grid', group: 'Layout', run: tileAll },
    { id: 'layout.stack', label: 'Stack all panels as tabs', group: 'Layout', run: stackAll },
    { id: 'terminal.clear', label: 'Clear terminal', group: 'Terminal', run: () => activeCtrl()?.clear() },
    { id: 'terminal.find', label: 'Find in terminal', group: 'Terminal', run: () => window.dispatchEvent(new CustomEvent('cfh:find', { detail: getDock()?.activePanel?.id })) },
    { id: 'font.bigger', label: 'Increase font size', group: 'View', run: () => fontDelta(1) },
    { id: 'font.smaller', label: 'Decrease font size', group: 'View', run: () => fontDelta(-1) },
    { id: 'font.reset', label: 'Reset font size', group: 'View', run: () => fontDelta(0) },
    { id: 'sidebar.toggle', label: 'Toggle sidebar', group: 'View', run: () => st.set({ sidebarVisible: !useStore.getState().sidebarVisible }) },
    { id: 'palette.open', label: 'Command palette', group: 'View', run: () => st.set({ paletteOpen: true }) },
    { id: 'site.quickOpen', label: 'Connect to site…', group: 'Sites', run: () => st.set({ paletteOpen: true }) },
    { id: 'site.new', label: 'New site…', group: 'Sites', run: () => st.set({ siteDialog: { site: null } }) },
    { id: 'files.open', label: 'Open file manager', group: 'Files', run: () => openFiles() },
    { id: 'transfers.open', label: 'Show transfers', group: 'Files', run: openTransfers },
    { id: 'settings.open', label: 'Settings', group: 'App', run: () => openSettings() },
    { id: 'settings.json', label: 'Edit config (JSON)', group: 'App', run: () => openSettings('json') },
    { id: 'theme.next', label: 'Next theme', group: 'View', run: () => cycleTheme() },
    { id: 'workspace.new', label: 'New AI workspace for this folder', group: 'AI', run: () => {
      const c = useStore.getState().context
      openWorkspace('new', { connection_id: c?.source === 'local' ? null : c?.source, path: c?.cwd ?? undefined })
    } },
    { id: 'agent.new', label: `New ${st.config.ai.defaultAgent} agent tab`, group: 'AI', run: () => newLocalTerminal('tab', st.config.ai.defaultAgent) },
    ...agents,
    ...Array.from({ length: 9 }, (_, i) => ({ id: `tab.goto.${i + 1}`, label: `Go to tab ${i + 1}`, group: 'Terminal', run: () => gotoTab(i + 1) })),
  ]
}

function cycleTheme() {
  import('./config/themes').then(({ THEMES }) => {
    const st = useStore.getState()
    const keys = Object.keys(THEMES)
    const next = keys[(keys.indexOf(st.config.theme) + 1) % keys.length]
    st.saveConfig({ ...st.userConfig, theme: next })
    st.toast(`Theme: ${THEMES[next].name}`)
  })
}

/** Effective key → command id map (defaults + user overrides). */
export function keyBindings(): Map<string, string> {
  const user = useStore.getState().config.keymap || {}
  const map = new Map<string, string>()
  const defaults = defaultKeys(detectModStyle(useStore.getState().caps?.mode === 'desktop'))
  for (const [cmd, key] of Object.entries({ ...defaults, ...user })) if (key) map.set(key, cmd)
  for (let i = 1; i <= 9; i++) if (!map.has(`mod+${i}`)) map.set(`mod+${i}`, `tab.goto.${i}`)
  return map
}

export function runCommand(id: string) {
  getCommands().find(c => c.id === id)?.run()
}
