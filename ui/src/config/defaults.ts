// Hyper-style configuration. Everything here can be overridden in
// Settings → "Edit config (JSON)"; values are deep-merged over these defaults.
export interface AppConfig {
  theme: string
  colors: Partial<Record<string, string>>
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontWeightBold: number
  lineHeight: number
  letterSpacing: number
  cursorStyle: 'block' | 'bar' | 'underline'
  cursorBlink: boolean
  padding: string
  backgroundOpacity: number
  scrollback: number
  copyOnSelect: boolean
  rightClick: 'menu' | 'paste' | 'copyPaste'
  bell: 'none' | 'visual' | 'sound'
  macOptionIsMeta: boolean
  webgl: boolean
  minimumContrastRatio: number
  tabs: { position: 'top' | 'bottom'; showIcons: boolean; closeOnExit: boolean }
  sidebar: { visible: boolean; width: number }
  notifications: { onBell: boolean; onAgentIdle: boolean; agentIdleSeconds: number }
  newTab: { kind: 'local' | 'site'; agent: 'shell' | 'claude' | 'codex' | 'opencode' }
  transfers: { policy: 'ask' | 'overwrite' | 'skip' | 'newer' | 'different' | 'rename' | 'resume'; concurrency: number; preserveTimes: boolean }
  ai: { globalPrompt: string; defaultAgent: 'claude' | 'codex' | 'opencode'; resumeOnRestore: boolean }
  editor: { fontSize: number; wordWrap: 'on' | 'off'; minimap: boolean; tabSize: number }
  keymap: Record<string, string>
}

export const DEFAULT_CONFIG: AppConfig = {
  theme: 'hyper',
  colors: {},
  fontFamily: 'Menlo, "JetBrains Mono", "SF Mono", "DejaVu Sans Mono", Consolas, "Lucida Console", monospace',
  fontSize: 13,
  fontWeight: 400,
  fontWeightBold: 700,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  padding: '10px 14px',
  backgroundOpacity: 1,
  scrollback: 10000,
  copyOnSelect: false,
  rightClick: 'menu',
  bell: 'visual',
  macOptionIsMeta: false,
  webgl: true,
  minimumContrastRatio: 1,
  tabs: { position: 'top', showIcons: true, closeOnExit: false },
  sidebar: { visible: true, width: 270 },
  notifications: { onBell: true, onAgentIdle: true, agentIdleSeconds: 6 },
  newTab: { kind: 'local', agent: 'shell' },
  transfers: { policy: 'ask', concurrency: 2, preserveTimes: true },
  ai: { globalPrompt: '', defaultAgent: 'claude', resumeOnRestore: true },
  editor: { fontSize: 13, wordWrap: 'off', minimap: true, tabSize: 2 },
  keymap: {},
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

export function mergeConfig<T>(base: T, over: any): T {
  if (!isObj(over)) return base
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) }
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? mergeConfig(out[k], v) : v
  return out
}

/** Only the keys that differ from the defaults are persisted. */
export function diffConfig(base: any, cur: any): any {
  if (!isObj(cur)) return cur
  const out: any = {}
  for (const [k, v] of Object.entries(cur)) {
    if (isObj(v) && isObj(base?.[k])) { const d = diffConfig(base[k], v); if (Object.keys(d).length) out[k] = d }
    else if (JSON.stringify(v) !== JSON.stringify(base?.[k])) out[k] = v
  }
  return out
}
