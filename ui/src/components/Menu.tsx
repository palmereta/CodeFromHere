import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label?: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  onClick?: () => void
  children?: MenuItem[]
}

export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: Math.min(x, window.innerWidth - r.width - 6), y: Math.min(y, window.innerHeight - r.height - 6) })
  }, [x, y])

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.menu')) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    setTimeout(() => window.addEventListener('mousedown', down), 0)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); window.removeEventListener('blur', onClose) }
  }, [onClose])

  return (
    <>
      <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
        {items.map((it, i) => it.separator ? <div key={i} className="menu-sep" /> : (
          <button key={i} className={`menu-item${it.danger ? ' danger' : ''}`} disabled={it.disabled}
            onMouseEnter={(e) => {
              if (it.children) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSub({ i, x: r.right, y: r.top }) }
              else setSub(null)
            }}
            onClick={() => { if (it.children) return; it.onClick?.(); onClose() }}>
            <span className="menu-icon">{it.icon}</span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
            {it.children && <span className="menu-hint">›</span>}
          </button>
        ))}
      </div>
      {sub && items[sub.i]?.children && <Menu x={sub.x} y={sub.y} items={items[sub.i].children!} onClose={onClose} />}
    </>
  )
}
