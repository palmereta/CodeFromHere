import { create } from 'zustand'
import type { TermController } from './TermController'

/** panelId → controller, for commands that act on the focused terminal. */
export const controllers = new Map<string, TermController>()

export interface TabState {
  status?: 'connecting' | 'running' | 'reconnecting' | 'exited' | 'error'
  activity?: boolean
  bell?: boolean
  waiting?: boolean
  dirty?: boolean
}

export const useTabState = create<{ tabs: Record<string, TabState>; patch: (id: string, s: Partial<TabState>) => void; clear: (id: string) => void }>((set) => ({
  tabs: {},
  patch: (id, s) => set((st) => ({ tabs: { ...st.tabs, [id]: { ...st.tabs[id], ...s } } })),
  clear: (id) => set((st) => { const t = { ...st.tabs }; delete t[id]; return { tabs: t } }),
}))

let audioCtx: AudioContext | null = null
export function beep() {
  try {
    audioCtx ||= new AudioContext()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.frequency.value = 880; g.gain.value = 0.04
    o.connect(g); g.connect(audioCtx.destination)
    o.start(); o.stop(audioCtx.currentTime + 0.08)
  } catch {}
}

export function notify(title: string, body: string, onClick?: () => void) {
  if (!('Notification' in window)) return
  const show = () => { const n = new Notification(title || 'CodeFromHere', { body, silent: false }); n.onclick = () => { window.focus(); onClick?.(); n.close() } }
  if (Notification.permission === 'granted') show()
  else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => p === 'granted' && show())
}
