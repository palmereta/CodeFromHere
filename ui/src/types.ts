export type SiteType = 'ssh' | 'sftp' | 'scp' | 'ftp' | 'ftps' | 's3' | 'telnet'
export type AgentId = 'shell' | 'claude' | 'codex' | 'opencode'
export type Source = number | 'local'

export interface Site {
  id: number
  name: string
  type: SiteType
  group_id: number | null
  host: string | null
  port: number | null
  username: string | null
  ssh_key_id: number | null
  use_agent: number
  jump_id: number | null
  root_path: string | null
  bucket: string | null
  region: string | null
  endpoint: string | null
  ftps_implicit: number
  tls_verify: number
  use_tmux: number
  startup_command: string | null
  tags: string | null
  notes: string | null
  color: string | null
  sort_order: number
  last_connected: string | null
  has_password: boolean
  has_private_key: boolean
  has_passphrase: boolean
  has_access_key: boolean
  has_secret_key: boolean
}

export interface SiteGroup { id: number; parent_id: number | null; name: string; color: string | null; sort_order: number; collapsed: number }

export interface FileEntry { name: string; path: string; isDir: boolean; isLink?: boolean; size: number; modified: number | null; mode?: number | null }

export interface SessionInfo {
  id: string; kind: 'local' | 'ssh' | 'telnet'; connectionId: number | null; title: string; cwd: string | null
  agent: AgentId; agentSessionId: string | null; tmuxName: string | null; cols: number; rows: number
  status: 'starting' | 'running' | 'exited' | 'error'; exitCode: number | null; error: string | null
  createdAt: number; lastActivity: number; attached: number
}

export interface Workspace {
  id: number; connection_id: number | null; path: string; name: string; system_prompt: string | null
  agent: AgentId | null; agent_args: string | null; env_json: string | null; context: string | null; inherit: number
  updated_at?: string
}

export interface AgentHistoryItem { agent: AgentId; id: string; cwd: string | null; title: string; updatedAt: number | null; size: number }

export interface TransferJob {
  id: string; status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'canceled'; mode: 'copy' | 'move'; policy: string
  createdAt: number; startedAt: number | null; finishedAt: number | null; scanning: boolean
  bytesTotal: number; bytesDone: number; speed: number; label: string; error: string | null
  files: { total: number; done: number; skipped: number; failed: number; running: number }
  src: Source; dst: Source; dstDir: string
  tasks?: { id: number; src: string; dst: string; size: number; done: number; status: string; error: string | null; attempts: number }[]
}

export interface User { id: number; username: string; email: string; role: 'admin' | 'user'; mfa_enabled: boolean }

export interface Capabilities { localShell: boolean; agents: { id: AgentId; label: string }[]; platform: string; mode: 'web' | 'desktop' }

/** Params stored in each terminal panel so the layout can be restored. */
export interface TerminalParams {
  sessionId?: string
  kind: 'local' | 'ssh' | 'telnet'
  connectionId?: number | null
  cwd?: string | null
  agent?: AgentId
  agentSessionId?: string | null
  tmuxName?: string | null
  tmux?: boolean
  title?: string
  resume?: { id?: string; last?: boolean }
  command?: string
}

export interface HostKeyInfo { host: string; port: number; fingerprint: string; keyType: string; connectionId: number; expected?: string }
