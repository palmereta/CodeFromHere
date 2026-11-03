// S3 and S3-compatible storage (AWS, MinIO, Wasabi, Backblaze B2, R2...).
// Directories are emulated with "/" delimited prefixes.
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command,
  CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { PassThrough } from 'node:stream'

const key = (p) => p.replace(/^\/+/, '')
const dirKey = (p) => { const k = key(p); return k && !k.endsWith('/') ? k + '/' : k }

export class S3Adapter {
  constructor(conn) {
    this.conn = conn
    this.bucket = conn.bucket
    this.caps = { chmod: false, resume: false, serverCopy: true }
    this.client = new S3Client({
      region: conn.region || 'us-east-1',
      endpoint: conn.endpoint || undefined,
      forcePathStyle: !!conn.endpoint,
      credentials: { accessKeyId: conn.access_key, secretAccessKey: conn.secret_key },
    })
  }

  get alive() { return true }
  async connect() {}
  async disconnect() { this.client.destroy?.() }
  async home() { return '/' }

  async list(path) {
    const prefix = dirKey(path)
    const out = []
    let token
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: token }))
      for (const p of r.CommonPrefixes || []) {
        const name = p.Prefix.slice(prefix.length).replace(/\/$/, '')
        out.push({ name, path: '/' + p.Prefix.replace(/\/$/, ''), isDir: true, size: 0, modified: null })
      }
      for (const o of r.Contents || []) {
        if (o.Key === prefix) continue
        out.push({ name: o.Key.slice(prefix.length), path: '/' + o.Key, isDir: false, size: o.Size, modified: o.LastModified?.getTime() ?? null, etag: o.ETag })
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined
    } while (token && out.length < 50_000)
    return out
  }

  async stat(path) {
    try {
      const h = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key(path) }))
      return { isDir: false, size: h.ContentLength, modified: h.LastModified?.getTime() ?? null }
    } catch (e) {
      if (e.$metadata?.httpStatusCode !== 404 && e.name !== 'NotFound') throw e
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: dirKey(path), MaxKeys: 1 }))
      return r.KeyCount ? { isDir: true, size: 0, modified: null } : null
    }
  }

  createReadStream(path, { start = 0 } = {}) {
    const out = new PassThrough()
    this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key(path), Range: start ? `bytes=${start}-` : undefined }))
      .then(r => { r.Body.on('error', e => out.destroy(e)); r.Body.pipe(out) })
      .catch(e => out.destroy(e))
    return out
  }

  async upload(path, readable, { onProgress } = {}) {
    const up = new Upload({ client: this.client, params: { Bucket: this.bucket, Key: key(path), Body: readable }, queueSize: 4, partSize: 8 * 1024 * 1024 })
    if (onProgress) up.on('httpUploadProgress', p => onProgress(p.loaded))
    await up.done()
  }

  async read(path) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key(path) }))
    return Buffer.from(await r.Body.transformToByteArray())
  }

  async write(path, buf) { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key(path), Body: buf })) }
  async mkdir(path) { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: dirKey(path), Body: '' })) }

  async delete(path, isDir) {
    if (!isDir) return this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: [{ Key: key(path) }] } }))
    let token
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: dirKey(path), ContinuationToken: token }))
      const objs = (r.Contents || []).map(o => ({ Key: o.Key }))
      if (objs.length) await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objs } }))
      token = r.IsTruncated ? r.NextContinuationToken : undefined
    } while (token)
  }

  async copyWithin(from, to) {
    await this.client.send(new CopyObjectCommand({ Bucket: this.bucket, Key: key(to), CopySource: encodeURI(`${this.bucket}/${key(from)}`) }))
  }

  async rename(from, to) {
    const st = await this.stat(from)
    if (st?.isDir) {
      for (const item of await this.list(from)) await this.rename(item.path, `${to}/${item.name}`)
      return this.delete(from, false).catch(() => {})
    }
    await this.copyWithin(from, to)
    await this.delete(from, false)
  }
}
