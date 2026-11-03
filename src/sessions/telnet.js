// Minimal RFC 854 Telnet client: negotiates ECHO, SGA, TTYPE and NAWS
// (window size), strips IAC sequences from the data stream and escapes 0xFF
// on the way out. Everything else is refused.
import net from 'node:net'
import { EventEmitter } from 'node:events'

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240
const ECHO = 1, SGA = 3, TTYPE = 24, NAWS = 31
const TTYPE_IS = 0, TTYPE_SEND = 1

export class TelnetClient extends EventEmitter {
  constructor({ host, port = 23, cols = 80, rows = 24, timeout = 15000 }) {
    super()
    this.cols = cols
    this.rows = rows
    this.naws = false
    this.state = 'data'
    this.sb = []
    this.socket = net.connect({ host, port })
    this.socket.setTimeout(timeout, () => { this.socket.destroy(new Error('Telnet connection timed out')) })
    this.socket.on('connect', () => { this.socket.setTimeout(0); this.emit('ready') })
    this.socket.on('data', (d) => this._parse(d))
    this.socket.on('error', (e) => this.emit('error', e))
    this.socket.on('close', () => this.emit('close'))
  }

  _send(...bytes) { this.socket.write(Buffer.from(bytes)) }

  _sendNaws() {
    const b = [IAC, SB, NAWS, this.cols >> 8, this.cols & 255, this.rows >> 8, this.rows & 255, IAC, SE]
    // 255 inside the subnegotiation must be doubled
    const out = []
    b.forEach((v, i) => { out.push(v); if (v === 255 && i > 2 && i < 7) out.push(255) })
    this._send(...out)
  }

  _negotiate(cmd, opt) {
    if (cmd === DO) {
      if (opt === TTYPE) return this._send(IAC, WILL, TTYPE)
      if (opt === NAWS) { this.naws = true; this._send(IAC, WILL, NAWS); return this._sendNaws() }
      return this._send(IAC, WONT, opt)
    }
    if (cmd === WILL) {
      if (opt === ECHO || opt === SGA) return this._send(IAC, DO, opt)
      return this._send(IAC, DONT, opt)
    }
    // DONT / WONT: acknowledge silently
  }

  _subnegotiation(bytes) {
    if (bytes[0] === TTYPE && bytes[1] === TTYPE_SEND) {
      this._send(IAC, SB, TTYPE, TTYPE_IS, ...Buffer.from('XTERM-256COLOR'), IAC, SE)
    }
  }

  _parse(data) {
    const out = []
    for (const byte of data) {
      switch (this.state) {
        case 'data':
          if (byte === IAC) this.state = 'iac'; else out.push(byte)
          break
        case 'iac':
          if (byte === IAC) { out.push(255); this.state = 'data' }
          else if (byte === SB) { this.state = 'sb'; this.sb = [] }
          else if ([DO, DONT, WILL, WONT].includes(byte)) { this.cmd = byte; this.state = 'opt' }
          else this.state = 'data'
          break
        case 'opt':
          this._negotiate(this.cmd, byte); this.state = 'data'
          break
        case 'sb':
          if (byte === IAC) this.state = 'sb-iac'; else this.sb.push(byte)
          break
        case 'sb-iac':
          if (byte === SE) { this._subnegotiation(this.sb); this.state = 'data' }
          else { this.sb.push(byte); this.state = 'sb' }
          break
      }
    }
    if (out.length) this.emit('data', Buffer.from(out))
  }

  write(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    if (!buf.includes(255)) return this.socket.write(buf)
    const out = []
    for (const b of buf) { out.push(b); if (b === 255) out.push(255) }
    this.socket.write(Buffer.from(out))
  }

  resize(cols, rows) {
    this.cols = cols; this.rows = rows
    if (this.naws) this._sendNaws()
  }

  end() { this.socket.end(); this.socket.destroy() }
}
