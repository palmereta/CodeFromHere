import type { DockviewPanelApi } from 'dockview'
import { Clipboard, Copy, Eraser, Search, SplitSquareHorizontal, SplitSquareVertical, TextCursorInput, X, Maximize2, FolderOpen } from 'lucide-react'
import { Menu } from './Menu'
import type { TermController } from '../terminal/TermController'
import type { TerminalParams } from '../types'
import { openTerminal, openFiles } from '../layout'
import { closeTerminal } from '../commands'

export function TermContextMenu({ x, y, ctrl, panel, params, onSearch, onClose }: {
  x: number; y: number; ctrl: TermController; panel: DockviewPanelApi; params: TerminalParams; onSearch: () => void; onClose: () => void
}) {
  const sel = ctrl.term.getSelection()
  return (
    <Menu x={x} y={y} onClose={onClose} items={[
      { label: 'Copy', icon: <Copy size={14} />, disabled: !sel, onClick: () => navigator.clipboard.writeText(sel) },
      { label: 'Paste', icon: <Clipboard size={14} />, onClick: () => navigator.clipboard.readText().then(t => ctrl.paste(t)) },
      { label: 'Select all', icon: <TextCursorInput size={14} />, onClick: () => ctrl.term.selectAll() },
      { separator: true },
      { label: 'Find…', icon: <Search size={14} />, onClick: onSearch },
      { label: 'Clear', icon: <Eraser size={14} />, onClick: () => ctrl.clear() },
      { separator: true },
      { label: 'Split right', icon: <SplitSquareHorizontal size={14} />, onClick: () => openTerminal({ kind: params.kind, connectionId: params.connectionId, cwd: params.cwd }, 'right') },
      { label: 'Split down', icon: <SplitSquareVertical size={14} />, onClick: () => openTerminal({ kind: params.kind, connectionId: params.connectionId, cwd: params.cwd }, 'below') },
      { label: panel.isMaximized() ? 'Restore' : 'Maximize', icon: <Maximize2 size={14} />, onClick: () => panel.isMaximized() ? panel.exitMaximized() : panel.maximize() },
      { label: 'Open files here', icon: <FolderOpen size={14} />, onClick: () => openFiles({ left: params.kind === 'local' ? 'local' : params.connectionId!, leftPath: params.cwd || undefined }) },
      { separator: true },
      { label: 'Close terminal', icon: <X size={14} />, danger: true, onClick: () => closeTerminal(panel.id) },
    ]} />
  )
}
