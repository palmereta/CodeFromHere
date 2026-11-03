import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { getCommands, keyBindings } from '../commands'
import { openSiteTerminal, openFiles } from '../layout'
import { detectModStyle, keyLabel } from '../config/keymap'
import { SiteIcon } from '../components/Icons'

interface Item { id: string; label: string; group: string; hint?: string; icon?: React.ReactNode; run: () => void }

function score(q: string, text: string) {
  if (!q) return 1
  const t = text.toLowerCase()
  let i = 0, s = 0, streak = 0
  for (const ch of t) {
    if (ch === q[i]) { i++; streak++; s += streak } else streak = 0
    if (i === q.length) return s + (t.startsWith(q) ? 20 : 0)
  }
  return 0
}

export function CommandPalette() {
  const sites = useStore(s => s.sites)
  const mode = useStore(s => s.caps?.mode)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const close = () => useStore.getState().set({ paletteOpen: false })
  useEffect(() => { input.current?.focus() }, [])

  const items = useMemo<Item[]>(() => {
    const keys = new Map([...keyBindings()].map(([k, c]) => [c, k]))
    const style = detectModStyle(mode === 'desktop')
    const cmds: Item[] = getCommands().map(c => ({ ...c, hint: keys.get(c.id) ? keyLabel(keys.get(c.id)!, style) : undefined }))
    const siteItems: Item[] = sites.flatMap(s => {
      const shell = ['ssh', 'sftp', 'scp', 'telnet'].includes(s.type)
      const out: Item[] = []
      if (shell) out.push({ id: `site.${s.id}`, label: `Connect: ${s.name}`, group: 'Sites', hint: `${s.username ? s.username + '@' : ''}${s.host}`, icon: <SiteIcon type={s.type} />, run: () => openSiteTerminal(s.id) })
      if (s.type !== 'telnet') out.push({ id: `files.${s.id}`, label: `Browse: ${s.name}`, group: 'Sites', hint: s.type, icon: <SiteIcon type={s.type} />, run: () => openFiles({ left: s.id }) })
      return out
    })
    const ql = q.toLowerCase()
    return [...siteItems, ...cmds].map(it => ({ it, s: score(ql, `${it.label} ${it.group}`) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 60).map(x => x.it)
  }, [q, sites])

  useEffect(() => setI(0), [q])
  const run = (it?: Item) => { if (!it) return; close(); setTimeout(it.run, 0) }

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="palette">
        <input ref={input} className="palette-input" placeholder="Type a command or site name…" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(items.length - 1, i + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)) }
            if (e.key === 'Enter') run(items[i])
          }} />
        <div className="palette-list">
          {items.map((it, idx) => (
            <div key={it.id} className={`palette-item${idx === i ? ' on' : ''}`} onMouseEnter={() => setI(idx)} onClick={() => run(it)}>
              <span className="palette-icon">{it.icon}</span><span>{it.label}</span><span className="muted sm">{it.group}</span><span className="spacer" />{it.hint && <span className="kbd">{it.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
