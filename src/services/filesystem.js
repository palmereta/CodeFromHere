import SftpClient from 'ssh2-sftp-client'
import * as ftp from 'basic-ftp'
import { S3Client, GetObjectCommand, PutObjectCommand,
         DeleteObjectCommand, ListObjectsV2Command,
         CopyObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

// Abstracción unificada — todos los adapters exponen:
// list(path), read(path), write(path, content), delete(path, isDir),
// mkdir(path), rename(oldPath, newPath), stat(path),
// readStream(path), writeStream(path, stream)

export class SftpAdapter {
  constructor(connConfig) { this.config = connConfig }

  async connect() {
    this.client = new SftpClient()
    const opts = {
      host:     this.config.host,
      port:     this.config.port || 22,
      username: this.config.username,
    }
    if (this.config.private_key) {
      opts.privateKey = this.config.private_key
      if (this.config.passphrase) opts.passphrase = this.config.passphrase
    } else {
      opts.password = this.config.password
    }
    await this.client.connect(opts)
  }

  async disconnect() { await this.client?.end() }

  async list(path) {
    const items = await this.client.list(path)
    return items.map(i => ({
      name:     i.name,
      path:     path.replace(/\/$/, '') + '/' + i.name,
      isDir:    i.type === 'd',
      size:     i.size,
      modified: i.modifyTime,
      permissions: i.rights,
    })).sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name))
  }

  async read(path)                { return await this.client.get(path) }
  async write(path, content)      { await this.client.put(Buffer.from(content), path) }
  async delete(path, isDir)       { isDir ? await this.client.rmdir(path, true) : await this.client.delete(path) }
  async mkdir(path)               { await this.client.mkdir(path, true) }
  async rename(oldPath, newPath)  { await this.client.rename(oldPath, newPath) }
  async stat(path)                { return await this.client.stat(path) }
  async readStream(path)          { return await this.client.get(path, null, { readStreamOptions: {} }) }
  async writeStream(path, stream) { await this.client.put(stream, path) }
  async chmod(path, mode)         { await this.client.chmod(path, mode) }
}

export class FtpAdapter {
  constructor(connConfig, ssl = false) {
    this.config = connConfig
    this.ssl = ssl
  }

  async connect() {
    this.client = new ftp.Client(30000)
    await this.client.access({
      host:          this.config.host,
      port:          this.config.port || (this.ssl ? 990 : 21),
      user:          this.config.username,
      password:      this.config.password,
      secure:        this.ssl,
      secureOptions: this.ssl ? { rejectUnauthorized: false } : undefined,
    })
    if (this.config.root_path && this.config.root_path !== '/') {
      await this.client.cd(this.config.root_path)
    }
  }

  async disconnect() { this.client?.close() }

  async list(path) {
    const items = await this.client.list(path)
    return items.map(i => ({
      name:     i.name,
      path:     path.replace(/\/$/, '') + '/' + i.name,
      isDir:    i.isDirectory,
      size:     i.size,
      modified: i.rawModifiedAt,
    })).sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name))
  }

  async read(path) {
    const chunks = []
    const writable = new (await import('stream')).Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk)
        callback()
      }
    })
    await this.client.downloadTo(writable, path)
    return Buffer.concat(chunks)
  }

  async write(path, content) {
    const { Readable } = await import('stream')
    await this.client.uploadFrom(Readable.from(Buffer.from(content)), path)
  }

  async delete(path, isDir)      { isDir ? await this.client.removeDir(path) : await this.client.remove(path) }
  async mkdir(path)              { await this.client.ensureDir(path) }
  async rename(oldPath, newPath) { await this.client.rename(oldPath, newPath) }
  async writeStream(path, stream){ await this.client.uploadFrom(stream, path) }
}

export class S3Adapter {
  constructor(connConfig) {
    this.config = connConfig
    this.bucket = connConfig.bucket
    this.client = new S3Client({
      region:         connConfig.region || 'us-east-1',
      endpoint:       connConfig.endpoint || undefined,
      credentials:    { accessKeyId: connConfig.access_key, secretAccessKey: connConfig.secret_key },
      forcePathStyle: !!connConfig.endpoint,
    })
  }

  _key(path) { return path.replace(/^\//, '') }

  async connect() { /* S3 no necesita connect explícito */ }
  async disconnect() { /* noop */ }

  async list(path) {
    const prefix = path === '/' ? '' : path.replace(/^\//, '').replace(/\/?$/, '/')
    const res = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket, Prefix: prefix, Delimiter: '/',
    }))
    const dirs = (res.CommonPrefixes || []).map(p => ({
      name: p.Prefix.replace(prefix, '').replace('/', ''),
      path: '/' + p.Prefix,
      isDir: true, size: 0,
    }))
    const files = (res.Contents || []).filter(o => o.Key !== prefix).map(o => ({
      name: o.Key.replace(prefix, ''),
      path: '/' + o.Key,
      isDir: false,
      size: o.Size,
      modified: o.LastModified,
    }))
    return [...dirs, ...files]
  }

  async read(path) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this._key(path) }))
    const chunks = []
    for await (const chunk of res.Body) chunks.push(chunk)
    return Buffer.concat(chunks)
  }

  async write(path, content) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: this._key(path), Body: Buffer.from(content),
    }))
  }

  async writeStream(path, stream) {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: this._key(path), Body: stream },
    })
    await upload.done()
  }

  async delete(path) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this._key(path) }))
  }

  async mkdir(path) {
    const key = this._key(path).replace(/\/?$/, '/')
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: '' }))
  }

  async rename(oldPath, newPath) {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket, Key: this._key(newPath),
      CopySource: `${this.bucket}/${this._key(oldPath)}`,
    }))
    await this.delete(oldPath)
  }
}

// Factory principal
export function createAdapter(connection) {
  switch (connection.type) {
    case 'sftp': return new SftpAdapter(connection)
    case 'ftp':  return new FtpAdapter(connection, false)
    case 'ftps': return new FtpAdapter(connection, true)
    case 's3':   return new S3Adapter(connection)
    default: throw new Error(`Tipo de conexión desconocido: ${connection.type}`)
  }
}
