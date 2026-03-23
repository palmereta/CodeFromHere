import { generateKeyPairSync } from 'crypto'

/**
 * Generate an Ed25519 SSH key pair.
 * Returns { publicKey, privateKey } where:
 *   - publicKey  is in OpenSSH format (ssh-ed25519 AAAA... comment)
 *   - privateKey is in PEM PKCS8 format (compatible with ssh2 library)
 */
export function generateUserKeyPair(comment = 'codefromhere') {
  const { publicKey: pubDer, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  // Ed25519 SPKI DER structure:
  //   30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes raw key>
  // The raw Ed25519 public key is always the last 32 bytes.
  const rawPubKey = pubDer.slice(-32)

  // Build the OpenSSH public key wire format:
  //   uint32(len("ssh-ed25519")) + "ssh-ed25519" + uint32(32) + <raw key>
  const typeStr = 'ssh-ed25519'
  const typeBytes = Buffer.from(typeStr)
  const buf = Buffer.alloc(4 + typeBytes.length + 4 + rawPubKey.length)
  buf.writeUInt32BE(typeBytes.length, 0)
  typeBytes.copy(buf, 4)
  buf.writeUInt32BE(rawPubKey.length, 4 + typeBytes.length)
  rawPubKey.copy(buf, 4 + typeBytes.length + 4)

  const sshPublicKey = `ssh-ed25519 ${buf.toString('base64')} ${comment}`

  return { publicKey: sshPublicKey, privateKey }
}
