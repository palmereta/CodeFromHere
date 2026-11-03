// One xterm.js instance bound to one server-side session.
// - The session outlives the UI: closing the browser only detaches.
// - Reconnects with backoff and asks only for the bytes it missed (`since`).
// - Parses OSC 7 (cwd), OSC 9 / 777 (notifications), bell and title changes.
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { api, wsUrl } from '../api'
import { withHostKey } from '../store'
import type { AppConfig } from '../config/defaults'
import type { Theme } from '../config/themes'
import type { SessionInfo, TerminalParams } from '../types'

export interface TermEvents {
  onParams(p: Partial<TerminalParams>): void
  onTitle(title: string): void
  onStatus(status: 'connecting' | 'running' | 'reconnecting' | 'exited' | 'error', detail?: string): void
  onBell(): void
  onNotify(title: string, body: string): void
  onActivity(): void
  onAgentIdle(): void
  onCwd(cwd: string): void
}

const encoder = new TextEncoder()

export function xtermTheme(t: Theme): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white, bBlack, bRed, bGreen, bYellow, bBlue, bMagenta, bCyan, bWhite] = t.ansi
  return {
    background: t.background, foreground: t.foreground, cursor: t.cursor, cursorAccent: t.cursorAccent ?? t.background,
    selectionBackground: t.selection, black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack: bBlack, brightRed: bRed, brightGreen: bGreen, brightYellow: bYellow, brightBlue: bBlue,
    brightMagenta: bMagenta, brightCyan: bCyan, brightWhite: bWhite,
  }
}

export class TermController {
  term: Terminal
  fit = new FitAddon()
  search = new SearchAddon()
  private webgl: WebglAddon | null = null
  private ws: WebSocket | null = null
  private offset: number | undefined
  private session: SessionInfo | null = null
  private retry = 0
  private retryTimer: number | null = null
  private disposed = false
  private exited = false
  private resizeObs: ResizeObserver
  private fitTimer: number | null = null
  private lastOutput = 0
  private burstStart = 0
  private idleTimer: number | null = null
  private userTitle = false
  private banner: string | null = null
  visible = true

  constructor(private host: HTMLElement, private params: TerminalParams, private cfg: AppConfig, theme: Theme, private ev: TermEvents) {
    this.term = new Terminal({
      allowProposedApi: true,
      allowTransparency: cfg.backgroundOpacity < 1,
      fontFamily: cfg.fontFamily,
      fontSize: cfg.fontSize,
      fontWeight: cfg.fontWeight as any,
      fontWeightBold: cfg.fontWeightBold as any,
      lineHeight: cfg.lineHeight,
      letterSpacing: cfg.letterSpacing,
      cursorStyle: cfg.cursorStyle,
      cursorBlink: cfg.cursorBlink,
      cursorInactiveStyle: 'outline',
      scrollback: cfg.scrollback,
      macOptionIsMeta: cfg.macOptionIsMeta,
      minimumContrastRatio: cfg.minimumContrastRatio,
      rightClickSelectsWord: cfg.rightClick === 'menu',
      theme: this.withOpacity(xtermTheme(theme)),
      windowsPty: navigator.platform.startsWith('Win') ? { backend: 'conpty' } : undefined,
    })
    this.term.loadAddon(this.fit)
    this.term.loadAddon(this.search)
    this.term.loadAddon(new WebLinksAddon((e, uri) => { if (e.metaKey || e.ctrlKey) window.open(uri, '_blank', 'noopener') }))
    const u = new Unicode11Addon()
    this.term.loadAddon(u)
    this.term.unicode.activeVersion = '11'
    this.term.open(host)
    if (cfg.webgl) this.enableWebgl()

    this.term.onData((d) => this.send(encoder.encode(d)))
    this.term.onBinary((d) => { const b = new Uint8Array(d.length); for (let i = 0; i < d.length; i++) b[i] = d.charCodeAt(i) & 255; this.send(b) })
    this.term.onBell(() => this.ev.onBell())
    this.term.onTitleChange((t) => { if (!this.userTitle && t) this.ev.onTitle(t) })
    this.term.onSelectionChange(() => {
      if (this.cfg.copyOnSelect && this.term.hasSelection()) navigator.clipboard?.writeText(this.term.getSelection()).catch(() => {})
    })

    // OSC 7: file://host/path — current directory reported by the shell.
    this.term.parser.registerOscHandler(7, (data) => {
      try { const u = new URL(data); const cwd = decodeURIComponent(u.pathname); this.ev.onCwd(cwd); this.ev.onParams({ cwd }) } catch {}
      return true
    })
    // OSC 9: iTerm2/Windows Terminal notification (used by Codex and others). "9;4;…" is progress, ignore.
    this.term.parser.registerOscHandler(9, (data) => {
      if (!/^\d;/.test(data)) this.ev.onNotify('', data)
      return true
    })
    // OSC 777;notify;title;body (urxvt / Ghostty / Claude Code).
    this.term.parser.registerOscHandler(777, (data) => {
      const [kind, title, ...body] = data.split(';')
      if (kind === 'notify') this.ev.onNotify(title || '', body.join(';'))
      return true
    })

    this.resizeObs = new ResizeObserver(() => this.scheduleFit())
    this.resizeObs.observe(host)
    this.start()
  }

  private withOpacity(t: ITheme): ITheme {
    if (this.cfg.backgroundOpacity >= 1 || !t.background?.startsWith('#')) return t
    const hex = t.background.slice(1)
    const n = parseInt(hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex.slice(0, 6), 16)
    return { ...t, background: `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${this.cfg.backgroundOpacity})` }
  }

  private enableWebgl() {
    try {
      this.webgl = new WebglAddon()
      this.webgl.onContextLoss(() => { this.webgl?.dispose(); this.webgl = null })
      this.term.loadAddon(this.webgl)
    } catch { this.webgl = null }
  }

  applyConfig(cfg: AppConfig, theme: Theme) {
    this.cfg = cfg
    const o = this.term.options
    o.fontFamily = cfg.fontFamily; o.fontSize = cfg.fontSize; o.lineHeight = cfg.lineHeight
    o.letterSpacing = cfg.letterSpacing; o.cursorStyle = cfg.cursorStyle; o.cursorBlink = cfg.cursorBlink
    o.scrollback = cfg.scrollback; o.macOptionIsMeta = cfg.macOptionIsMeta; o.minimumContrastRatio = cfg.minimumContrastRatio
    o.fontWeight = cfg.fontWeight as any; o.fontWeightBold = cfg.fontWeightBold as any
    o.theme = this.withOpacity(xtermTheme(theme))
    this.scheduleFit()
  }

  setFontSize(px: number) { this.term.options.fontSize = Math.max(6, Math.min(48, px)); this.scheduleFit() }

  setUserTitle(v: boolean) { this.userTitle = v }

  scheduleFit() {
    if (this.fitTimer) cancelAnimationFrame(this.fitTimer)
    this.fitTimer = requestAnimationFrame(() => {
      if (this.disposed || !this.host.offsetWidth || !this.host.offsetHeight) return
      try { this.fit.fit() } catch { return }
      this.sendControl({ t: 'resize', cols: this.term.cols, rows: this.term.rows })
    })
  }

  focus() { this.term.focus() }

  private send(bytes: Uint8Array<ArrayBuffer>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(bytes)
  }
  private sendControl(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }
  /** Types text into the session (paths dropped from the explorer, snippets…). */
  paste(text: string) { this.term.paste(text) }

  private async start() {
    this.ev.onStatus('connecting')
    try {
      // Re-attach when the server still has the session (page reload, other device).
      if (this.params.sessionId) {
        const live = await api.get<SessionInfo[]>('/api/sessions').catch(() => [])
        const s = live.find(x => x.id === this.params.sessionId)
        if (s && s.status !== 'exited' && s.status !== 'error') { this.session = s; return this.connect() }
      }
      await this.create(!!this.params.sessionId)
    } catch (e: any) {
      this.ev.onStatus('error', e.message)
      this.term.writeln(`\r\n\x1b[31m✖ ${e.message}\x1b[0m`)
      this.term.writeln('\x1b[90mPress Enter to retry.\x1b[0m')
      const sub = this.term.onData((d) => { if (d === '\r') { sub.dispose(); this.term.reset(); this.start() } })
    }
  }

  private async create(restoring: boolean) {
    this.fitNow()
    const p = this.params
    // A restored agent tab resumes its previous conversation.
    let resume = p.resume
    if (restoring && !resume && p.agent && p.agent !== 'shell' && this.cfg.ai.resumeOnRestore) {
      resume = p.agent === 'claude' && p.agentSessionId ? { id: p.agentSessionId } : { last: true }
    }
    const body = {
      kind: p.kind, connectionId: p.connectionId, cwd: p.cwd, agent: p.agent || 'shell',
      agentSessionId: p.agentSessionId, tmux: p.tmux, tmuxName: p.tmuxName, command: restoring ? undefined : p.command,
      resume, cols: this.term.cols, rows: this.term.rows,
    }
    const s = await withHostKey(() => api.post<SessionInfo>('/api/sessions', body))
    this.session = s
    this.offset = undefined
    if (restoring) this.banner = '\x1b[90m— previous session ended; started a new one' + (resume ? ' (resuming conversation)' : '') + ' —\x1b[0m'
    this.ev.onParams({ sessionId: s.id, agentSessionId: s.agentSessionId ?? p.agentSessionId, tmuxName: s.tmuxName, cwd: s.cwd, resume: undefined })
    if (!this.userTitle && s.title && !p.title) this.ev.onTitle(s.title)
    this.connect()
  }

  private fitNow() { try { if (this.host.offsetWidth) this.fit.fit() } catch {} }

  private connect() {
    if (this.disposed || !this.session) return
    const q = this.offset !== undefined ? `?since=${this.offset}` : ''
    const ws = new WebSocket(wsUrl(`/ws/session/${this.session.id}${q}`))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.ev.onStatus('running')
      this.scheduleFit()
    }
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') return this.onControl(JSON.parse(m.data))
      const buf = new Uint8Array(m.data)
      if (this.offset !== undefined) this.offset += buf.length
      this.term.write(buf)
      this.trackActivity()
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.disposed || this.exited) return
      if (e.code === 4404) {
        // Session vanished (server restart or reaped): start a new one in place.
        this.session = null
        this.create(true).catch(err => this.ev.onStatus('error', err.message))
        return
      }
      this.ev.onStatus('reconnecting')
      const delay = Math.min(15000, 500 * 2 ** this.retry++)
      this.retryTimer = window.setTimeout(() => this.connect(), delay)
    }
  }

  private onControl(msg: any) {
    if (msg.t === 'hello') {
      // Fell behind the retained buffer, or first attach: repaint from scratch.
      if (this.offset === undefined || msg.truncated || msg.from !== this.offset) this.term.reset()
      if (this.banner) { this.term.writeln(this.banner); this.banner = null }
      this.offset = msg.from
      this.session = msg.session
    } else if (msg.t === 'exit') {
      this.exited = true
      const detail = msg.error ? msg.error : `exit code ${msg.code ?? '?'}`
      this.term.writeln(`\r\n\x1b[90m— session ended (${detail}). Press Enter to restart —\x1b[0m`)
      this.ev.onStatus(msg.error ? 'error' : 'exited', detail)
      const sub = this.term.onData((d) => {
        if (d !== '\r') return
        sub.dispose()
        this.exited = false
        this.session = null
        this.create(false).catch(err => this.ev.onStatus('error', err.message))
      })
    }
  }

  private trackActivity() {
    const now = Date.now()
    if (now - this.lastOutput > 1500) this.burstStart = now
    this.lastOutput = now
    if (!this.visible) this.ev.onActivity()
    // Agent tabs: a long burst of output followed by silence means the agent
    // finished its turn and is waiting for you.
    if (this.params.agent && this.params.agent !== 'shell' && this.cfg.notifications.onAgentIdle) {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.idleTimer = window.setTimeout(() => {
        if (this.lastOutput - this.burstStart > 3000) this.ev.onAgentIdle()
      }, this.cfg.notifications.agentIdleSeconds * 1000)
    }
  }

  clear() { this.term.clear() }

  /** Detaches the UI. The server keeps the session alive. */
  dispose() {
    this.disposed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.resizeObs.disconnect()
    try { this.ws?.close() } catch {}
    this.webgl?.dispose()
    this.term.dispose()
  }

  /** Ends the server-side session too (explicit tab close). */
  async kill() {
    const id = this.session?.id || this.params.sessionId
    this.dispose()
    if (id) await api.del(`/api/sessions/${id}`).catch(() => {})
  }

  get sessionId() { return this.session?.id || this.params.sessionId }
}
