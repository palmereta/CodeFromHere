import { api } from './api'
import { useStore } from './store'
import { askChoice } from './dialogs/Prompt'
import type { FileEntry, Source } from './types'

export const POLICY_LABELS: Record<string, string> = {
  ask: 'Ask', overwrite: 'Overwrite', skip: 'Skip', newer: 'Overwrite if source is newer',
  different: 'Overwrite if size differs', rename: 'Keep both (rename)', resume: 'Resume',
}

/** Queues a transfer job between two sources (FTP→S3, local→SFTP, …). */
export async function startTransfer(items: FileEntry[], from: Source, to: Source, dstDir: string, mode: 'copy' | 'move' = 'copy', policyOverride?: string) {
  if (!items.length) return
  const st = useStore.getState()
  let policy = policyOverride || st.config.transfers.policy
  if (policy === 'ask') {
    const choice = await askChoice(`${mode === 'move' ? 'Move' : 'Copy'} ${items.length === 1 ? `"${items[0].name}"` : `${items.length} items`} → ${dstDir}`,
      ['overwrite', 'newer', 'different', 'resume', 'rename', 'skip'].map(v => ({ value: v, label: POLICY_LABELS[v], primary: v === 'newer' })),
      'If a file already exists at the destination:')
    if (!choice) return
    policy = choice
  }
  try {
    await api.post('/api/transfers', {
      items: items.map(i => ({ src: { source: from, path: i.path, isDir: i.isDir, size: i.size, modified: i.modified }, dst: { source: to, dir: dstDir } })),
      mode, policy, concurrency: st.config.transfers.concurrency, preserveTimes: st.config.transfers.preserveTimes,
    })
    st.toast(`${mode === 'move' ? 'Moving' : 'Copying'} ${items.length} item(s)…`)
  } catch (e: any) { st.toast(e.message, 'error') }
}

/** Uploads files dropped from the OS; keeps folder structure when available. */
export async function uploadFiles(files: { file: File; rel: string }[], to: Source, dir: string, onDone?: () => void) {
  const st = useStore.getState()
  const fd = new FormData()
  fd.append('source', String(to))
  fd.append('dir', dir)
  for (const f of files) fd.append('file', f.file, f.rel)
  st.toast(`Uploading ${files.length} file(s)…`)
  try { await api.post('/api/files/upload', fd); st.toast(`Uploaded ${files.length} file(s)`, 'success'); onDone?.() }
  catch (e: any) { st.toast(`Upload failed: ${e.message}`, 'error') }
}

/** Reads a drop event into files, walking dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<{ file: File; rel: string }[]> {
  const out: { file: File; rel: string }[] = []
  const entries = [...dt.items].map(i => (i as any).webkitGetAsEntry?.()).filter(Boolean)
  if (!entries.length) return [...dt.files].map(f => ({ file: f, rel: f.name }))
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) { out.push({ file: await new Promise<File>((res, rej) => entry.file(res, rej)), rel: prefix + entry.name }); return }
    const reader = entry.createReader()
    let batch: any[]
    do {
      batch = await new Promise<any[]>((res, rej) => reader.readEntries(res, rej))
      for (const e of batch) await walk(e, `${prefix}${entry.name}/`)
    } while (batch.length)
  }
  for (const e of entries) await walk(e, '')
  return out
}

export function downloadFile(source: Source, path: string) {
  const a = document.createElement('a')
  a.href = `/api/files/download?${api.qs({ source, path })}`
  a.download = path.split(/[\\/]/).pop() || 'download'
  document.body.appendChild(a); a.click(); a.remove()
}
