// Keyboard shortcuts. "mod" = Cmd on macOS desktop, Ctrl+Shift elsewhere
// (plain Ctrl+T/W/D belong to the shell), Alt+Shift inside a browser tab
// (the browser owns Cmd/Ctrl+T/W).
export const COMMAND_KEYS: Record<string, string> = {
  'tab.new': 'mod+t',
  'tab.close': 'mod+w',
  'tab.next': 'mod+]',
  'tab.prev': 'mod+[',
  'split.right': 'mod+d',
  'split.down': 'mod+shift+d',
  'panel.maximize': 'mod+enter',
  'palette.open': 'mod+shift+p',
  'site.quickOpen': 'mod+o',
  'sidebar.toggle': 'mod+b',
  'settings.open': 'mod+,',
  'terminal.clear': 'mod+k',
  'terminal.find': 'mod+f',
  'font.bigger': 'mod+=',
  'font.smaller': 'mod+-',
  'font.reset': 'mod+0',
  'files.open': 'mod+e',
  'transfers.open': 'mod+shift+u',
  'agent.new': 'mod+shift+a',
}

/** Linux/Windows/browser: Ctrl+Shift (or Alt+Shift) is already the base, so a few
 * defaults drop the extra shift to stay at two modifiers, like Windows Terminal. */
export const COMMAND_KEYS_NON_MAC: Record<string, string> = {
  'palette.open': 'mod+p',
  'transfers.open': 'mod+u',
  'agent.new': 'mod+a',
  'panel.maximize': 'mod+enter',
}

export type ModStyle = 'cmd' | 'ctrlShift' | 'altShift'

export function defaultKeys(style: ModStyle): Record<string, string> {
  return style === 'cmd' ? COMMAND_KEYS : { ...COMMAND_KEYS, ...COMMAND_KEYS_NON_MAC }
}

export function detectModStyle(isDesktop: boolean): ModStyle {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  if (isDesktop) return mac ? 'cmd' : 'ctrlShift'
  return 'altShift'
}

/**
 * Normalised key string for an event, e.g. "mod+shift+d".
 * In the non-mac styles Shift is part of "mod", so "+shift" is expressed with
 * the remaining modifier: Alt for Ctrl+Shift, Ctrl for Alt+Shift.
 */
export function eventToKey(e: KeyboardEvent, style: ModStyle): string | null {
  let mod = false
  let shift = false
  if (style === 'cmd') { mod = e.metaKey && !e.ctrlKey; shift = e.shiftKey }
  else if (style === 'ctrlShift') { mod = e.ctrlKey && e.shiftKey && !e.metaKey; shift = e.altKey }
  else { mod = e.altKey && e.shiftKey && !e.metaKey; shift = e.ctrlKey }
  if (!mod) return null
  let k = e.key.toLowerCase()
  if (k === '+') k = '='
  if (e.code === 'BracketRight') k = ']'
  if (e.code === 'BracketLeft') k = '['
  if (e.code === 'Comma') k = ','
  if (e.code === 'Equal') k = '='
  if (e.code === 'Minus') k = '-'
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5)
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase()
  return `mod+${shift ? 'shift+' : ''}${k}`
}

export function keyLabel(key: string, style: ModStyle) {
  const mod = style === 'cmd' ? '⌘' : style === 'ctrlShift' ? 'Ctrl+Shift+' : 'Alt+Shift+'
  const extra = style === 'cmd' ? '⇧' : style === 'ctrlShift' ? 'Alt+' : 'Ctrl+'
  return key.replace('mod+', mod).replace('shift+', extra).replace('enter', '↵').toUpperCase()
}
