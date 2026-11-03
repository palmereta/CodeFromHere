import { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Modal } from './Prompt'

const FORMATS = [
  { id: 'ssh_config', label: 'OpenSSH config (~/.ssh/config)' },
  { id: 'filezilla', label: 'FileZilla Site Manager (sitemanager.xml)' },
  { id: 'csv', label: 'CSV (name,type,host,port,username,password,…)' },
]

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState('ssh_config')
  const [content, setContent] = useState('')
  const [result, setResult] = useState<any>(null)
  const run = async () => {
    try { const r = await api.post('/api/connections/import', { format, content }); setResult(r); useStore.getState().loadSites() }
    catch (e: any) { setResult({ error: e.message }) }
  }
  return (
    <Modal title="Import sites" onClose={onClose} wide>
      <label>Format<select className="select" value={format} onChange={e => setFormat(e.target.value)}>{FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
      <label className="btn sm">Choose file…<input type="file" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) { setContent(await f.text()); if (f.name.endsWith('.xml')) setFormat('filezilla'); else if (f.name.endsWith('.csv')) setFormat('csv') } }} /></label>
      <textarea className="input mono" rows={10} value={content} onChange={e => setContent(e.target.value)} placeholder="…or paste the content here" />
      <p className="muted sm">Passwords from FileZilla are imported encrypted. SSH config hosts use ssh-agent (desktop) or your CodeFromHere key. Groups/folders are kept.</p>
      {result && (result.error ? <div className="error">{result.error}</div> : <div className="ok">Imported {result.imported} site(s){result.failed ? `, ${result.failed} failed: ${result.errors.map((e: any) => `${e.name || '#' + e.row}: ${e.error}`).join('; ')}` : ''}</div>)}
      <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={!content.trim()} onClick={run}>Import</button></div>
    </Modal>
  )
}
