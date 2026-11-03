import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'

interface Choice { value: string; label: string; hint?: string; primary?: boolean; danger?: boolean }
interface PromptReq { kind: 'text' | 'confirm' | 'choice'; title: string; message?: ReactNode; value?: string; placeholder?: string; choices?: Choice[]; resolve: (v: string | null) => void }

const usePrompt = create<{ req: PromptReq | null }>(() => ({ req: null }))

const ask = (r: Omit<PromptReq, 'resolve'>) => new Promise<string | null>(resolve => usePrompt.setState({ req: { ...r, resolve } }))

export const askText = (title: string, value = '', placeholder = '') => ask({ kind: 'text', title, value, placeholder })
export const askConfirm = async (title: string, message?: ReactNode, danger = false) =>
  (await ask({ kind: 'choice', title, message, choices: [{ value: 'no', label: 'Cancel' }, { value: 'yes', label: danger ? 'Delete' : 'OK', primary: !danger, danger }] })) === 'yes'
export const askChoice = (title: string, choices: Choice[], message?: ReactNode) => ask({ kind: 'choice', title, choices, message })

export function Modal({ title, children, onClose, wide }: { title: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

export function PromptHost() {
  const req = usePrompt(s => s.req)
  const [v, setV] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!req) return
    setV(req.value ?? '')
    setTimeout(() => {
      input.current?.focus()
      // Select the name without its extension, like a file manager.
      const val = req.value ?? ''
      const dot = val.lastIndexOf('.')
      input.current?.setSelectionRange(0, dot > 0 ? dot : val.length)
    }, 20)
  }, [req])
  if (!req) return null
  const done = (val: string | null) => { usePrompt.setState({ req: null }); req.resolve(val) }
  return (
    <Modal title={req.title} onClose={() => done(null)}>
      {req.message && <div className="modal-msg">{req.message}</div>}
      {req.kind === 'text' && (
        <form onSubmit={(e) => { e.preventDefault(); done(v) }}>
          <input ref={input} className="input" value={v} placeholder={req.placeholder} onChange={(e) => setV(e.target.value)} />
          <div className="modal-actions"><button type="button" className="btn" onClick={() => done(null)}>Cancel</button><button className="btn primary">OK</button></div>
        </form>
      )}
      {req.kind === 'choice' && (
        <div className="modal-actions wrap">
          {req.choices!.map(c => (
            <button key={c.value} autoFocus={c.primary} className={`btn${c.primary ? ' primary' : ''}${c.danger ? ' danger' : ''}`} title={c.hint} onClick={() => done(c.value)}>{c.label}</button>
          ))}
        </div>
      )}
    </Modal>
  )
}
