import { generateKeyPairSync } from 'crypto'

/**
 * Generate an RSA-4096 SSH key pair.
 * Returns { publicKey, privateKey } where:
 *   - publicKey  is in OpenSSH format (ssh-rsa AAAA... comment)
 *   - privateKey is in PEM format (compatible with ssh2 library)
 *
 * Uses RSA instead of Ed25519 because ssh2 library requires
 * OpenSSH-format private keys for Ed25519, which Node.js crypto
 * cannot export natively. RSA PEM is universally supported.
 */
export function generateUserKeyPair(comment = 'codefromhere') {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })

  // Convert DER SPKI to OpenSSH ssh-rsa format
  // RSA SPKI DER contains the modulus and exponent in ASN.1 structure
  // OpenSSH wire format: string("ssh-rsa") + mpint(e) + mpint(n)
  const sshPublicKey = derToOpenSSH(publicKey, comment)

  return { publicKey: sshPublicKey, privateKey }
}

/**
 * Convert a DER-encoded RSA SPKI public key to OpenSSH format.
 * Parses the ASN.1 structure to extract modulus (n) and exponent (e),
 * then encodes them in SSH wire format.
 */
function derToOpenSSH(derBuffer, comment) {
  // Parse ASN.1 to extract n and e from RSA SPKI DER
  // Structure: SEQUENCE { SEQUENCE { OID, NULL }, BIT STRING { SEQUENCE { INTEGER n, INTEGER e } } }
  const parsed = parseRSAPublicKeyDER(derBuffer)

  const typeStr = 'ssh-rsa'
  const typeBytes = Buffer.from(typeStr)

  // SSH wire format: each component is length-prefixed (uint32 BE)
  const eBuf = toSSHMpint(parsed.e)
  const nBuf = toSSHMpint(parsed.n)

  const totalLen = 4 + typeBytes.length + 4 + eBuf.length + 4 + nBuf.length
  const buf = Buffer.alloc(totalLen)
  let offset = 0

  // Write type string
  buf.writeUInt32BE(typeBytes.length, offset); offset += 4
  typeBytes.copy(buf, offset); offset += typeBytes.length

  // Write exponent
  buf.writeUInt32BE(eBuf.length, offset); offset += 4
  eBuf.copy(buf, offset); offset += eBuf.length

  // Write modulus
  buf.writeUInt32BE(nBuf.length, offset); offset += 4
  nBuf.copy(buf, offset); offset += nBuf.length

  return `ssh-rsa ${buf.toString('base64')} ${comment}`
}

/**
 * Parse RSA public key from DER SPKI format.
 * Returns { n: Buffer, e: Buffer } (modulus and exponent).
 */
function parseRSAPublicKeyDER(der) {
  let pos = 0

  function readTag() {
    const tag = der[pos++]
    let len = der[pos++]
    if (len & 0x80) {
      const numBytes = len & 0x7f
      len = 0
      for (let i = 0; i < numBytes; i++) {
        len = (len << 8) | der[pos++]
      }
    }
    return { tag, len, start: pos }
  }

  // Outer SEQUENCE
  readTag()
  // Inner SEQUENCE (algorithm identifier) — skip it
  const algoSeq = readTag()
  pos = algoSeq.start + algoSeq.len
  // BIT STRING
  const bitString = readTag()
  pos++ // skip the unused-bits byte (0x00)
  // Inner SEQUENCE (RSA key)
  readTag()
  // INTEGER n (modulus)
  const nTag = readTag()
  const n = der.slice(nTag.start, nTag.start + nTag.len)
  pos = nTag.start + nTag.len
  // INTEGER e (exponent)
  const eTag = readTag()
  const e = der.slice(eTag.start, eTag.start + eTag.len)

  return { n, e }
}

/**
 * Convert a buffer to SSH mpint format (strip leading zeros, add 0x00 prefix if high bit set).
 */
function toSSHMpint(buf) {
  // Strip leading zeros
  let start = 0
  while (start < buf.length - 1 && buf[start] === 0) start++
  buf = buf.slice(start)

  // If high bit is set, prepend 0x00 (SSH mpint is signed)
  if (buf[0] & 0x80) {
    buf = Buffer.concat([Buffer.from([0x00]), buf])
  }
  return buf
}
