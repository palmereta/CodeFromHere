// Transfer queue between any two sources (local, SFTP, SCP, FTP/FTPS, S3):
// streaming (constant memory), N parallel workers per job, retries with
// reconnect, overwrite policies, resume, move, pause/cancel and live progress.
import { EventEmitter } from 'node:events'
import { Transform } from 'node:stream'
import { nanoid } from 'nanoid'
import { openSource } from '../services/vfs/index.js'
import { auditLog } from '../security/audit.js'

export const POLICIES = ['overwrite', 'skip', 'newer', 'different', 'rename', 'resume']
const MAX_ATTEMPTS = 3
const HISTORY_PER_USER = 100

export const bus = new EventEmitter() // emits ('job', userId, jobSummary)
bus.setMaxListeners(0)
const jobs = new Map()

const join = (dir, name) => (dir.includes('\\') && !dir.includes('/') ? `${dir.replace(/\\+$/, '')}\\${name}` : `${dir.replace(/\/+$/, '')}/${name}`)
const basename = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class Job {
  constructor(user, { items, mode = 'copy', policy = 'overwrite', concurrency = 2, preserveTimes = true }) {
    this.id = nanoid(12)
    this.user = user
    this.userId = user.id
    this.mode = mode === 'move' ? 'move' : 'copy'
    this.policy = POLICIES.includes(policy) ? policy : 'overwrite'
    this.concurrency = Math.max(1, Math.min(6, Number(concurrency) || 2))
    this.preserveTimes = preserveTimes
    this.items = items
    this.status = 'queued'
    this.tasks = []
    this.createdAt = Date.now()
    this.startedAt = null
    this.finishedAt = null
    this.bytesTotal = 0
    this.bytesDone = 0
    this.error = null
    this.scanning = true
    this.active = new Set() // running task objects
    this.lastEmit = 0
    this.speedSamples = []
  }

  summary(full = false) {
    const count = (s) => this.tasks.filter(t => t.status === s).length
    const now = Date.now()
    const recent = this.speedSamples.filter(s => now - s.t < 5000)
    const speed = recent.length > 1 ? (recent.at(-1).b - recent[0].b) / ((recent.at(-1).t - recent[0].t) / 1000 || 1) : 0
    return {
      id: this.id, status: this.status, mode: this.mode, policy: this.policy, concurrency: this.concurrency,
      createdAt: this.createdAt, startedAt: this.startedAt, finishedAt: this.finishedAt, scanning: this.scanning,
      bytesTotal: this.bytesTotal, bytesDone: this.bytesDone, speed: Math.max(0, Math.round(speed)),
      files: { total: this.tasks.length, done: count('done'), skipped: count('skipped'), failed: count('failed'), running: this.active.size },
      label: this.items.length === 1 ? basename(this.items[0].src.path) : `${this.items.length} items`,
      src: this.items[0]?.src.source, dst: this.items[0]?.dst.source, dstDir: this.items[0]?.dst.dir,
      error: this.error,
      tasks: full ? this.tasks.map(t => ({ id: t.id, src: t.srcPath, dst: t.dstPath, size: t.size, done: t.done, status: t.status, error: t.error, attempts: t.attempts })) : undefined,
    }
  }

  emit(force = false) {
    const now = Date.now()
    if (!force && now - this.lastEmit < 250) return
    this.lastEmit = now
    this.speedSamples.push({ t: now, b: this.bytesDone })
    if (this.speedSamples.length > 40) this.speedSamples.shift()
    bus.emit('job', this.userId, this.summary())
  }
}

// --- Worker side ------------------------------------------------------------

class Endpoint {
  constructor(job, source) { this.job = job; this.source = source; this.adapter = null }
  async get() {
    if (this.adapter?.alive) return this.adapter
    try { await this.adapter?.disconnect() } catch {}
    this.adapter = await openSource(this.job.userId, this.source, this.job.user)
    return this.adapter
  }
  async reset() { try { await this.adapter?.disconnect() } catch {} this.adapter = null }
}

async function uniqueName(dst, path) {
  const m = path.match(/^(.*?)(\.[^./\\]*)?$/)
  for (let i = 1; i < 1000; i++) {
    const candidate = `${m[1]} (${i})${m[2] || ''}`
    if (!(await dst.stat(candidate))) return candidate
  }
  throw new Error('Could not find a free name')
}

/** Expands directories into file tasks (breadth-first) while workers already run. */
async function scan(job) {
  const src = new Endpoint(job, job.items[0].src.source)
  try {
    for (const item of job.items) {
      if (job.status === 'canceled') return
      if (src.source !== item.src.source) { await src.reset(); src.source = item.src.source }
      const a = await src.get()
      const target = join(item.dst.dir, basename(item.src.path))
      if (!item.src.isDir) {
        const st = item.src.size !== undefined ? item.src : await a.stat(item.src.path)
        addTask(job, item, item.src.path, target, st?.size ?? 0, st?.modified ?? null)
        continue
      }
      const queue = [[item.src.path, target, null]]
      while (queue.length) {
        if (job.status === 'canceled') return
        const [dir, dstDir, parent] = queue.shift()
        const dirTask = addTask(job, item, dir, dstDir, 0, null, true, parent)
        for (const e of await a.list(dir)) {
          if (e.isDir && !e.isLink) queue.push([e.path, join(dstDir, e.name), dirTask])
          else if (!e.isDir) addTask(job, item, e.path, join(dstDir, e.name), e.size || 0, e.modified, false, dirTask)
        }
      }
    }
  } finally {
    job.scanning = false
    await src.reset()
    job.emit(true)
  }
}

function addTask(job, item, srcPath, dstPath, size, modified, isDir = false, parent = null) {
  const task = {
    id: job.tasks.length + 1, item, srcPath, dstPath, size, modified, isDir, parent,
    status: 'queued', done: 0, attempts: 0, error: null, abort: null,
  }
  job.tasks.push(task)
  if (!isDir) job.bytesTotal += size
  job.wake?.()
  return task
}

/** Next runnable task: its destination folder must already exist. */
function nextTask(job) {
  for (const t of job.tasks) {
    if (t.status !== 'queued') continue
    if (!t.parent || t.parent.status === 'done') return t
    if (t.parent.status === 'failed' || t.parent.status === 'skipped') {
      t.status = 'failed'
      t.error = 'Destination folder could not be created'
    }
  }
  return null
}

async function transferFile(job, task, src, dst) {
  const s = await src.get()
  const d = await dst.get()

  if (task.isDir) { await d.mkdir(task.dstPath); return 'done' }

  // Same S3 bucket → server-side copy, no bytes through us.
  if (s === d && s.copyWithin) { await s.copyWithin(task.srcPath, task.dstPath); job.bytesDone += task.size; task.done = task.size; return 'done' }

  let dstPath = task.dstPath
  let startAt = 0
  const existing = await d.stat(dstPath)
  if (existing && !existing.isDir) {
    const p = job.policy
    if (p === 'skip') return 'skipped'
    if (p === 'newer' && existing.modified && task.modified && existing.modified >= task.modified) return 'skipped'
    if (p === 'different' && existing.size === task.size) return 'skipped'
    if (p === 'rename') dstPath = await uniqueName(d, dstPath)
    if (p === 'resume' && d.caps.resume && s.caps.resume && existing.size < task.size) startAt = existing.size
    if (p === 'resume' && existing.size === task.size) return 'skipped'
  }
  // Also resume our own partial upload after a retry.
  if (!startAt && task.done > 0 && d.caps.resume && s.caps.resume) {
    const st = await d.stat(dstPath)
    if (st && st.size < task.size) startAt = st.size
  }

  job.bytesDone -= task.done
  task.done = startAt
  job.bytesDone += startAt

  const counter = new Transform({
    transform(chunk, _enc, cb) { task.done += chunk.length; job.bytesDone += chunk.length; job.emit(); cb(null, chunk) },
  })
  const rs = s.createReadStream(task.srcPath, { start: startAt })
  task.abort = (err) => { rs.destroy(err); counter.destroy(err) }
  rs.on('error', (e) => counter.destroy(e))
  rs.pipe(counter)
  await d.upload(dstPath, counter, { append: startAt > 0, size: task.size })
  task.abort = null
  if (job.preserveTimes && task.modified && d.setModified) { try { await d.setModified(dstPath, task.modified) } catch {} }
  return 'done'
}

async function worker(job) {
  const srcs = new Map(), dsts = new Map()
  const ep = (map, source) => { if (!map.has(source)) map.set(source, new Endpoint(job, source)); return map.get(source) }
  try {
    while (true) {
      if (job.status === 'canceled' || job.status === 'paused') return
      const task = nextTask(job)
      if (!task) {
        const waiting = job.tasks.some(t => t.status === 'queued' || t.status === 'running')
        if (!job.scanning && !waiting) return
        await new Promise(r => { job.wake = r; setTimeout(r, 500) })
        continue
      }
      task.status = 'running'
      job.active.add(task)
      const src = ep(srcs, task.item.src.source), dst = ep(dsts, task.item.dst.source)
      try {
        task.attempts++
        task.status = await transferFile(job, task, src, dst)
        task.error = null
      } catch (err) {
        if (job.status === 'paused' || job.status === 'canceled') { task.status = 'queued' }
        else if (task.attempts < MAX_ATTEMPTS) {
          task.status = 'queued'
          task.error = err.message
          await src.reset(); await dst.reset()
          await sleep(1000 * task.attempts)
        } else {
          task.status = 'failed'
          task.error = err.message
        }
      } finally {
        job.active.delete(task)
        job.emit()
      }
    }
  } finally {
    for (const e of [...srcs.values(), ...dsts.values()]) await e.reset()
  }
}

async function deleteMovedSources(job) {
  // Only delete a source when every task that came from it succeeded.
  const byItem = new Map()
  for (const t of job.tasks) {
    const list = byItem.get(t.item) || []
    list.push(t)
    byItem.set(t.item, list)
  }
  for (const [item, tasks] of byItem) {
    if (!tasks.every(t => t.status === 'done')) continue
    const a = await openSource(job.userId, item.src.source, job.user)
    try { await a.delete(item.src.path, !!item.src.isDir) } catch (e) { job.error = `Copied, but could not delete source: ${e.message}` }
    finally { await a.disconnect() }
  }
}

async function run(job) {
  job.status = 'running'
  job.startedAt ||= Date.now()
  job.emit(true)
  if (!job.tasks.length) { scan(job).catch(e => { job.error = e.message; job.scanning = false }) }
  await Promise.all(Array.from({ length: job.concurrency }, () => worker(job)))
  if (job.status === 'paused' || job.status === 'canceled') { job.emit(true); return }
  if (job.mode === 'move') await deleteMovedSources(job)
  const failed = job.tasks.filter(t => t.status === 'failed').length
  job.status = failed ? 'failed' : 'done'
  job.error ||= failed ? `${failed} file(s) failed` : null
  job.finishedAt = Date.now()
  job.emit(true)
  auditLog(job.userId, 'transfer_finished', {
    job: job.id, mode: job.mode, status: job.status, files: job.tasks.length, failed, bytes: job.bytesDone,
    src: String(job.items[0]?.src.source), dst: String(job.items[0]?.dst.source),
  })
}

// --- Public API -------------------------------------------------------------

export function createJob(user, spec) {
  if (!Array.isArray(spec.items) || !spec.items.length) throw Object.assign(new Error('items required'), { statusCode: 400 })
  const job = new Job(user, spec)
  jobs.set(job.id, job)
  auditLog(user.id, 'transfer_started', { job: job.id, mode: job.mode, policy: job.policy, items: spec.items.length,
    src: String(spec.items[0].src.source), dst: String(spec.items[0].dst.source), path: spec.items[0].src.path })
  // Trim history
  const mine = [...jobs.values()].filter(j => j.userId === user.id && ['done', 'failed', 'canceled'].includes(j.status))
  for (const old of mine.slice(0, Math.max(0, mine.length - HISTORY_PER_USER))) jobs.delete(old.id)
  run(job).catch(e => { job.status = 'failed'; job.error = e.message; job.emit(true) })
  return job.summary()
}

const own = (id, userId) => { const j = jobs.get(id); return j && j.userId === userId ? j : null }

export const listJobs = (userId) => [...jobs.values()].filter(j => j.userId === userId).map(j => j.summary()).reverse()
export const getJob = (id, userId) => own(id, userId)?.summary(true) ?? null

export function controlJob(id, userId, action) {
  const job = own(id, userId)
  if (!job) return null
  if (action === 'pause' && job.status === 'running') {
    job.status = 'paused'
    for (const t of job.active) t.abort?.(new Error('paused'))
  } else if (action === 'resume' && job.status === 'paused') {
    // Resume partial files where the protocol allows it.
    run(job).catch(e => { job.status = 'failed'; job.error = e.message; job.emit(true) })
  } else if (action === 'cancel' && ['running', 'paused', 'queued'].includes(job.status)) {
    job.status = 'canceled'
    job.finishedAt = Date.now()
    for (const t of job.active) t.abort?.(new Error('canceled'))
  } else if (action === 'retry' && ['failed', 'done'].includes(job.status)) {
    for (const t of job.tasks) if (t.status === 'failed') { t.status = 'queued'; t.attempts = 0 }
    job.error = null
    run(job).catch(e => { job.status = 'failed'; job.error = e.message; job.emit(true) })
  } else if (action === 'remove' && !['running'].includes(job.status)) {
    jobs.delete(id)
    return { removed: true }
  }
  job.emit(true)
  return job.summary()
}

/** Folder comparison for sync (FileZilla "directory comparison"). */
export async function compareDirs(user, left, right) {
  const [a, b] = await Promise.all([openSource(user.id, left.source, user), openSource(user.id, right.source, user)])
  try {
    const [la, lb] = await Promise.all([a.list(left.path), b.list(right.path)])
    const mb = new Map(lb.map(e => [e.name, e]))
    const rows = []
    for (const e of la) {
      const o = mb.get(e.name)
      mb.delete(e.name)
      let state = 'only-left'
      if (o) {
        if (e.isDir || o.isDir) state = e.isDir === o.isDir ? 'same' : 'type-differs'
        else if (e.size === o.size && (!e.modified || !o.modified || Math.abs(e.modified - o.modified) < 2000)) state = 'same'
        else if (e.modified && o.modified) state = e.modified > o.modified ? 'newer-left' : 'newer-right'
        else state = 'different'
      }
      rows.push({ name: e.name, isDir: e.isDir, left: e, right: o || null, state })
    }
    for (const o of mb.values()) rows.push({ name: o.name, isDir: o.isDir, left: null, right: o, state: 'only-right' })
    return rows.sort((x, y) => (y.isDir - x.isDir) || x.name.localeCompare(y.name))
  } finally { await Promise.all([a.disconnect(), b.disconnect()]) }
}

export function cancelAll() { for (const j of jobs.values()) if (j.status === 'running') controlJob(j.id, j.userId, 'cancel') }
