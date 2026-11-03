// Byte ring buffer with absolute offsets. Clients remember how many bytes
// they have seen; on reconnect they receive only the missing tail (or the
// whole retained buffer if they fell too far behind).
export class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity
    this.chunks = []
    this.size = 0
    this.end = 0 // absolute offset of the byte after the last stored one
  }

  get start() { return this.end - this.size }

  push(buf) {
    if (!buf.length) return
    this.chunks.push(buf)
    this.size += buf.length
    this.end += buf.length
    while (this.size > this.capacity && this.chunks.length > 1) {
      this.size -= this.chunks.shift().length
    }
    if (this.size > this.capacity) { // single huge chunk
      const only = this.chunks[0]
      this.chunks[0] = only.subarray(only.length - this.capacity)
      this.size = this.capacity
    }
  }

  /** Returns { data, from, truncated } for everything after absolute offset `since`. */
  since(since = 0) {
    const from = Math.max(since, this.start)
    const truncated = since < this.start
    let skip = from - this.start
    const parts = []
    for (const c of this.chunks) {
      if (skip >= c.length) { skip -= c.length; continue }
      parts.push(skip ? c.subarray(skip) : c)
      skip = 0
    }
    return { data: Buffer.concat(parts), from, truncated }
  }
}
