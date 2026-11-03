import { Bot, FileCode2, FolderTree, Settings, SquareTerminal, ArrowDownUp, Sparkles, Globe, Server, Database, Cable } from 'lucide-react'
import type { AgentId, SiteType } from '../types'

export function AgentIcon({ agent, size = 13 }: { agent?: AgentId | null; size?: number }) {
  if (!agent || agent === 'shell') return <SquareTerminal size={size} />
  if (agent === 'claude') return <Sparkles size={size} />
  return <Bot size={size} />
}

export function PanelIcon({ component, params, size = 13 }: { component: string; params?: any; size?: number }) {
  switch (component) {
    case 'terminal': return <AgentIcon agent={params?.agent} size={size} />
    case 'editor': return <FileCode2 size={size} />
    case 'files': return <FolderTree size={size} />
    case 'settings': return <Settings size={size} />
    case 'transfers': return <ArrowDownUp size={size} />
    case 'workspace': return <Sparkles size={size} />
    default: return <SquareTerminal size={size} />
  }
}

export function SiteIcon({ type, size = 14 }: { type: SiteType; size?: number }) {
  if (type === 's3') return <Database size={size} />
  if (type === 'ftp' || type === 'ftps') return <Globe size={size} />
  if (type === 'telnet') return <Cable size={size} />
  return <Server size={size} />
}
