import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { TermController } from '../terminal/TermController'

export function SearchBar({ ctrl, onClose }: { ctrl: TermController; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [regex, setRegex] = useState(false)
  const [cs, setCs] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const opts = { regex, caseSensitive: cs, decorations: { matchOverviewRuler: '#888', activeMatchColorOverviewRuler: '#f81ce5', matchBackground: '#555', activeMatchBackground: '#f81ce5' } }
  const next = () => ctrl.search.findNext(q, opts)
  const prev = () => ctrl.search.findPrevious(q, opts)
  return (
    <div className="term-search" onKeyDown={(e) => {
      if (e.key === 'Escape') { ctrl.search.clearDecorations(); onClose() }
      if (e.key === 'Enter') { e.shiftKey ? prev() : next() }
    }}>
      <input ref={ref} value={q} placeholder="Find" onChange={(e) => { setQ(e.target.value); ctrl.search.findNext(e.target.value, { ...opts, incremental: true }) }} />
      <button className={cs ? 'on' : ''} title="Match case" onClick={() => setCs(!cs)}>Aa</button>
      <button className={regex ? 'on' : ''} title="Regular expression" onClick={() => setRegex(!regex)}>.*</button>
      <button title="Previous (Shift+Enter)" onClick={prev}><ChevronUp size={14} /></button>
      <button title="Next (Enter)" onClick={next}><ChevronDown size={14} /></button>
      <button title="Close (Esc)" onClick={() => { ctrl.search.clearDecorations(); onClose() }}><X size={14} /></button>
    </div>
  )
}
