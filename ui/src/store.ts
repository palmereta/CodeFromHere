import { create } from 'zustand'
import { api } from './api'
import { DEFAULT_CONFIG, mergeConfig, type AppConfig } from './config/defaults'
import { THEMES, type Theme } from './config/themes'
import type { Capabilities, HostKeyInfo, SessionInfo, Site, SiteGroup, TransferJob, User, Workspace } from './types'

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }
export type SidebarTab = 'sites' | 'files' | 'sessions' | 'ai'

interface State {
  user: User | null
  caps: Capabilities | null
  userConfig: any
  config: AppConfig
  theme: Theme
  sites: Site[]
  groups: SiteGroup[]
  workspaces: Workspace[]
  sessions: SessionInfo[]
  transfers: TransferJob[]
  sidebarTab: SidebarTab
  sidebarVisible: boolean
  paletteOpen: boolean
  siteDialog: { site: Partial<Site> | null } | null
  hostKeyPrompt: (HostKeyInfo & { mismatch: boolean; resolve: (ok: boolean) => void }) | null
  toasts: Toast[]
  /** Source + folder of the focused panel; drives the explorer and AI sidebars. */
  context: { source: number | 'local'; cwd: string | null } | null

  set: (p: Partial<State>) => void
  loadAll: () => Promise<void>
  loadSites: () => Promise<void>
  loadWorkspaces: () => Promise<void>
  loadSessions: () => Promise<void>
  saveConfig: (userConfig: any) => Promise<void>
  toast: (text: string, kind?: Toast['kind']) => void
}

function resolveTheme(cfg: AppConfig): Theme {
  const base = THEMES[cfg.theme] || THEMES.hyper
  return { ...base, ...(cfg.colors as any) }
}

let toastId = 0

export const useStore = create<State>((set, get) => ({
  user: null,
  caps: null,
  userConfig: {},
  config: DEFAULT_CONFIG,
  theme: THEMES.hyper,
  sites: [],
  groups: [],
  workspaces: [],
  sessions: [],
  transfers: [],
  sidebarTab: 'sites',
  sidebarVisible: true,
  paletteOpen: false,
  siteDialog: null,
  hostKeyPrompt: null,
  toasts: [],
  context: null,

  set: (p) => set(p),

  loadAll: async () => {
    const [caps, prefs] = await Promise.all([api.get<Capabilities>('/api/sessions/capabilities'), api.get('/api/prefs')])
    const config = mergeConfig(DEFAULT_CONFIG, prefs.config)
    set({ caps, userConfig: prefs.config, config, theme: resolveTheme(config), sidebarVisible: config.sidebar.visible })
    await Promise.all([get().loadSites(), get().loadWorkspaces(), get().loadSessions(),
      api.get<TransferJob[]>('/api/transfers').then(transfers => set({ transfers }))])
  },

  loadSites: async () => {
    const [sites, groups] = await Promise.all([api.get<Site[]>('/api/connections'), api.get<SiteGroup[]>('/api/connections/groups')])
    set({ sites, groups })
  },

  loadWorkspaces: async () => set({ workspaces: await api.get<Workspace[]>('/api/workspaces') }),
  loadSessions: async () => set({ sessions: await api.get<SessionInfo[]>('/api/sessions') }),

  saveConfig: async (userConfig) => {
    const config = mergeConfig(DEFAULT_CONFIG, userConfig)
    set({ userConfig, config, theme: resolveTheme(config) })
    await api.put('/api/prefs/config', userConfig)
  },

  toast: (text, kind = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter(t => t.id !== id) }), kind === 'error' ? 7000 : 3500)
  },
}))

/** Asks the user to trust an SSH host key; resolves true when accepted. */
export function promptHostKey(info: HostKeyInfo, mismatch: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    useStore.getState().set({
      hostKeyPrompt: {
        ...info, mismatch,
        resolve: async (ok) => {
          useStore.getState().set({ hostKeyPrompt: null })
          if (ok) {
            try {
              await api.post(`/api/connections/${info.connectionId}/trust-host`, { fingerprint: info.fingerprint, host: info.host, port: info.port, keyType: info.keyType })
            } catch (e: any) { useStore.getState().toast(e.message, 'error'); return resolve(false) }
          }
          resolve(ok)
        },
      },
    })
  })
}

/** Runs fn; on HOSTKEY_UNKNOWN/MISMATCH asks the user and retries once. */
export async function withHostKey<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (e: any) {
    const code = e?.code ?? e?.data?.code
    const info = e?.hostKey ?? e?.data?.hostKey
    if ((code === 'HOSTKEY_UNKNOWN' || code === 'HOSTKEY_MISMATCH') && info) {
      if (await promptHostKey(info, code === 'HOSTKEY_MISMATCH')) return fn()
    }
    throw e
  }
}

export const siteById = (id: number | null | undefined) => useStore.getState().sites.find(s => s.id === id) || null
export const sourceLabel = (src: number | 'local' | null | undefined) =>
  src === 'local' || src === null || src === undefined ? 'Local' : siteById(src)?.name || `#${src}`
