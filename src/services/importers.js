// Site importers: CSV (v1 format), OpenSSH ~/.ssh/config and FileZilla
// sitemanager.xml. Each returns [{ ...connectionFields, group: 'A/B' }].

export function parseCSV(text) {
  const clean = text.replace(/^﻿/, '').trim()
  const rows = []
  let row = [], val = '', inQ = false
  const pushVal = () => { row.push(val.trim()); val = '' }
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (c === '"') { if (inQ && clean[i + 1] === '"') { val += '"'; i++ } else inQ = !inQ; continue }
    if (c === ',' && !inQ) { pushVal(); continue }
    if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && clean[i + 1] === '\n') i++
      pushVal(); rows.push(row); row = []; continue
    }
    val += c
  }
  pushVal(); rows.push(row)
  if (rows.length < 2) return []
  const headers = rows[0].map(h => h.toLowerCase())
  return rows.slice(1).filter(r => r.some(Boolean)).map(r => {
    const o = {}
    headers.forEach((h, i) => { o[h] = r[i] || '' })
    if (o.auth_method?.toLowerCase() === 'publickey') o.password = ''
    o.type = (o.type || '').toLowerCase()
    return o
  })
}

export function parseSshConfig(text) {
  const out = []
  let cur = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const m = line.match(/^(\S+)\s*=?\s*(.+)$/)
    if (!m) continue
    const key = m[1].toLowerCase(), value = m[2].trim().replace(/^"|"$/g, '')
    if (key === 'host') {
      cur = null
      for (const alias of value.split(/\s+/)) {
        if (/[*?!]/.test(alias)) continue // patterns are defaults, not sites
        cur = { name: alias, type: 'ssh', host: alias, port: 22, use_agent: 1, group: 'SSH config' }
        out.push(cur)
      }
    } else if (cur && key === 'hostname') cur.host = value
    else if (cur && key === 'user') cur.username = value
    else if (cur && key === 'port') cur.port = Number(value) || 22
    else if (cur && key === 'proxyjump') cur.notes = `ProxyJump ${value}`
  }
  return out
}

// Tiny XML reader, enough for FileZilla's flat, well-formed export.
function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) { stack.at(-1).text += m[5]; continue }
    if (!m[2]) continue
    if (m[1]) { if (stack.length > 1) stack.pop(); continue }
    const attrs = {}
    for (const a of m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    const node = { name: m[2], attrs, children: [], text: '' }
    stack.at(-1).children.push(node)
    if (!m[4]) stack.push(node)
  }
  return root
}

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

export function parseFileZilla(xml) {
  const out = []
  const PROTO = { 0: 'ftp', 1: 'sftp', 3: 'ftps', 4: 'ftps', 6: 'ftp' }
  const walk = (node, path) => {
    for (const child of node.children) {
      if (child.name === 'Folder') {
        const name = unescapeXml(child.text.trim().split('\n')[0] || 'Folder')
        walk(child, [...path, name])
      } else if (child.name === 'Server') {
        const get = (n) => child.children.find(c => c.name === n)
        const val = (n) => unescapeXml(get(n)?.text?.trim() || '')
        const passNode = get('Pass')
        let password = passNode ? unescapeXml(passNode.text.trim()) : ''
        if (passNode?.attrs.encoding === 'base64') password = Buffer.from(password, 'base64').toString('utf8')
        const protocol = Number(val('Protocol') || 0)
        out.push({
          name: val('Name') || val('Host'),
          type: PROTO[protocol] || 'ftp',
          host: val('Host'),
          port: Number(val('Port')) || undefined,
          username: val('User'),
          password,
          ftps_implicit: protocol === 3 ? 1 : 0,
          root_path: val('RemoteDir') ? '/' : '/',
          group: path.join('/') || 'FileZilla',
        })
      } else {
        walk(child, path)
      }
    }
  }
  walk(parseXml(xml), [])
  return out
}
