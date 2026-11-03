import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { TelnetClient } from '../src/sessions/telnet.js'

const IAC = 255, DO = 253, WILL = 251, SB = 250, SE = 240, TTYPE = 24, NAWS = 31, ECHO = 1

describe('TelnetClient', () => {
  it('negotiates NAWS/TTYPE, strips IAC and escapes 0xFF', async () => {
    const received = []
    const server = net.createServer((sock) => {
      sock.on('data', (d) => received.push(...d))
      // DO NAWS, DO TTYPE, WILL ECHO, SB TTYPE SEND, then text with an escaped 0xFF
      sock.write(Buffer.from([IAC, DO, NAWS, IAC, DO, TTYPE, IAC, WILL, ECHO, IAC, SB, TTYPE, 1, IAC, SE]))
      sock.write(Buffer.concat([Buffer.from('login: '), Buffer.from([IAC, IAC])]))
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const t = new TelnetClient({ host: '127.0.0.1', port: server.address().port, cols: 100, rows: 40 })
    let text = Buffer.alloc(0)
    t.on('data', (d) => { text = Buffer.concat([text, d]) })
    await new Promise(r => t.once('ready', r))
    await new Promise(r => setTimeout(r, 150))
    t.write(Buffer.from([0x61, 0xff]))
    await new Promise(r => setTimeout(r, 100))

    expect(text.toString('latin1')).toBe('login: \xff')
    const bytes = Buffer.from(received)
    expect(bytes.includes(Buffer.from([IAC, WILL, NAWS]))).toBe(true)
    expect(bytes.includes(Buffer.from([IAC, SB, NAWS, 0, 100, 0, 40, IAC, SE]))).toBe(true)
    expect(bytes.includes(Buffer.from([IAC, DO, ECHO]))).toBe(true)
    expect(bytes.toString('latin1')).toContain('XTERM-256COLOR')
    expect(bytes.includes(Buffer.from([0x61, 0xff, 0xff]))).toBe(true)
    t.end(); server.close()
  })
})
