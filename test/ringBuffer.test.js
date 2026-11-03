import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../src/sessions/ringBuffer.js'

describe('RingBuffer', () => {
  it('returns only the bytes after an offset', () => {
    const r = new RingBuffer(100)
    r.push(Buffer.from('hello '))
    r.push(Buffer.from('world'))
    expect(r.since(6).data.toString()).toBe('world')
    expect(r.since(0).data.toString()).toBe('hello world')
    expect(r.since(11).data.length).toBe(0)
  })

  it('drops old chunks past capacity and flags truncation', () => {
    const r = new RingBuffer(10)
    r.push(Buffer.from('aaaaaa'))
    r.push(Buffer.from('bbbbbb'))
    expect(r.size).toBeLessThanOrEqual(10)
    const res = r.since(0)
    expect(res.truncated).toBe(true)
    expect(res.from).toBe(6)
    expect(res.data.toString()).toBe('bbbbbb')
    expect(r.end).toBe(12)
  })

  it('trims a single chunk larger than capacity', () => {
    const r = new RingBuffer(4)
    r.push(Buffer.from('0123456789'))
    expect(r.since(0).data.toString()).toBe('6789')
  })
})
