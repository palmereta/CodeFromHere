import { describe, it, expect } from 'vitest'
import { parseCSV, parseSshConfig, parseFileZilla } from '../src/services/importers.js'

describe('importers', () => {
  it('parses quoted CSV with commas and newlines', () => {
    const rows = parseCSV('name,type,host,password\n"Web, prod",SFTP,web.example.com,"p""w"\nDB,ftp,db.local,x\n')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Web, prod', type: 'sftp', host: 'web.example.com', password: 'p"w' })
  })

  it('parses ~/.ssh/config and skips wildcard hosts', () => {
    const rows = parseSshConfig(`Host *\n  User ignored\nHost web prod-web\n  HostName 10.0.0.5\n  User deploy\n  Port 2200\nHost bastion\n  HostName b.example.com # comment\n`)
    expect(rows.map(r => r.name)).toEqual(['web', 'prod-web', 'bastion'])
    expect(rows[1]).toMatchObject({ host: '10.0.0.5', username: 'deploy', port: 2200, type: 'ssh' })
    expect(rows[2].host).toBe('b.example.com')
  })

  it('parses FileZilla folders, protocols and base64 passwords', () => {
    const xml = `<?xml version="1.0"?><FileZilla3><Servers>
      <Folder expanded="1">Clients
        <Server><Host>ftp.acme.com</Host><Port>21</Port><Protocol>0</Protocol><User>acme</User><Pass encoding="base64">c2VjcmV0</Pass><Name>Acme &amp; Co</Name></Server>
        <Folder>Nested<Server><Host>s.acme.com</Host><Port>22</Port><Protocol>1</Protocol><User>root</User><Name>SFTP</Name></Server></Folder>
      </Folder>
      <Server><Host>tls.example</Host><Protocol>3</Protocol><Name>Implicit</Name></Server>
    </Servers></FileZilla3>`
    const rows = parseFileZilla(xml)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ name: 'Acme & Co', type: 'ftp', password: 'secret', group: 'Clients' })
    expect(rows[1]).toMatchObject({ type: 'sftp', group: 'Clients/Nested' })
    expect(rows[2]).toMatchObject({ type: 'ftps', ftps_implicit: 1, group: 'FileZilla' })
  })
})
