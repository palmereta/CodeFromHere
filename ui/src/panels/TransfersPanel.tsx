import { useState } from 'react'
import { Pause, Play, RotateCcw, X, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { api, formatBytes, timeAgo } from '../api'
import { useStore, sourceLabel } from '../store'
import type { TransferJob } from '../types'

function eta(j: TransferJob) {
  if (!j.speed || j.status !== 'running' || j.scanning) return ''
  const s = Math.round((j.bytesTotal - j.bytesDone) / j.speed)
  return s > 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

function JobRow({ job }: { job: TransferJob }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<TransferJob | null>(null)
  const pct = job.bytesTotal ? Math.min(100, Math.round((job.bytesDone / job.bytesTotal) * 100)) : (job.status === 'done' ? 100 : 0)
  const act = (a: string) => api.post(`/api/transfers/${job.id}/${a}`).then(r => {
    if (r?.removed) useStore.getState().set({ transfers: useStore.getState().transfers.filter(t => t.id !== job.id) })
  }).catch(e => useStore.getState().toast(e.message, 'error'))
  const toggle = async () => { setOpen(!open); if (!open) setDetail(await api.get(`/api/transfers/${job.id}`)) }
  return (
    <div className={`job ${job.status}`}>
      <div className="job-main">
        <button className="icon-btn" onClick={toggle}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <div className="job-info">
          <div className="job-title">
            <b>{job.mode === 'move' ? 'Move' : 'Copy'}</b> {job.label}
            <span className="muted"> · {sourceLabel(job.src)} → {sourceLabel(job.dst)}:{job.dstDir}</span>
          </div>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
          <div className="job-meta muted">
            <span className={`status ${job.status}`}>{job.scanning && job.status === 'running' ? 'scanning…' : job.status}</span>
            <span>{job.files.done + job.files.skipped}/{job.files.total} files{job.files.skipped ? ` (${job.files.skipped} skipped)` : ''}{job.files.failed ? ` · ${job.files.failed} failed` : ''}</span>
            <span>{formatBytes(job.bytesDone)} / {formatBytes(job.bytesTotal)}</span>
            {job.status === 'running' && <span>{formatBytes(job.speed)}/s {eta(job) && `· ${eta(job)} left`}</span>}
            <span>{timeAgo(job.createdAt)} ago</span>
            {job.error && <span className="error">{job.error}</span>}
          </div>
        </div>
        <div className="job-actions">
          {job.status === 'running' && <button className="icon-btn" title="Pause" onClick={() => act('pause')}><Pause size={14} /></button>}
          {job.status === 'paused' && <button className="icon-btn" title="Resume" onClick={() => act('resume')}><Play size={14} /></button>}
          {(job.status === 'failed' || (job.status === 'done' && job.files.failed > 0)) && <button className="icon-btn" title="Retry failed" onClick={() => act('retry')}><RotateCcw size={14} /></button>}
          {['running', 'paused', 'queued'].includes(job.status) && <button className="icon-btn" title="Cancel" onClick={() => act('cancel')}><X size={14} /></button>}
          {['done', 'failed', 'canceled'].includes(job.status) && <button className="icon-btn" title="Remove from list" onClick={() => act('remove')}><Trash2 size={14} /></button>}
        </div>
      </div>
      {open && detail?.tasks && (
        <div className="job-tasks">
          {detail.tasks.slice(0, 500).map(t => (
            <div key={t.id} className={`task ${t.status}`}>
              <span className="mono">{t.src}</span><span className="muted">{formatBytes(t.size)}</span><span className={`status ${t.status}`}>{t.status}</span>
              {t.error && <span className="error">{t.error}</span>}
            </div>
          ))}
          {detail.tasks.length > 500 && <div className="muted">…and {detail.tasks.length - 500} more</div>}
        </div>
      )}
    </div>
  )
}

export function TransfersPanel() {
  const jobs = useStore(s => s.transfers)
  const clear = async () => {
    for (const j of jobs.filter(j => ['done', 'canceled'].includes(j.status))) await api.post(`/api/transfers/${j.id}/remove`).catch(() => {})
    useStore.getState().set({ transfers: useStore.getState().transfers.filter(j => !['done', 'canceled'].includes(j.status)) })
  }
  return (
    <div className="scroll-panel">
      <div className="panel-head"><h2>Transfers</h2><span className="spacer" /><button className="btn sm" onClick={clear}>Clear finished</button></div>
      {!jobs.length && <p className="muted">No transfers yet. Drag files between panes of the file manager, or between sites, to copy them — FTP → S3, local → SFTP, any combination.</p>}
      {jobs.map(j => <JobRow key={j.id} job={j} />)}
    </div>
  )
}
