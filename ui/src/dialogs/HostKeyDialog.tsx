import { useStore } from '../store'
import { Modal } from './Prompt'

export function HostKeyDialog() {
  const p = useStore(s => s.hostKeyPrompt)!
  return (
    <Modal title={p.mismatch ? '⚠️  Host key changed' : 'Trust this host?'} onClose={() => p.resolve(false)}>
      {p.mismatch ? (
        <div className="modal-msg error">
          The key presented by <b>{p.host}:{p.port}</b> does not match the one you trusted before. Someone could be intercepting
          the connection (man-in-the-middle), or the server was reinstalled. Only continue if you know why it changed.
        </div>
      ) : (
        <div className="modal-msg">First connection to <b>{p.host}:{p.port}</b>. Check the fingerprint with the server administrator
          (<code>ssh-keygen -lf /etc/ssh/ssh_host_{p.keyType?.replace('ssh-', '').replace('ecdsa-sha2-nistp256', 'ecdsa')}_key.pub</code>).</div>
      )}
      <table className="table sm">
        <tbody>
          <tr><td>Key type</td><td className="mono">{p.keyType}</td></tr>
          <tr><td>Fingerprint</td><td className="mono">{p.fingerprint}</td></tr>
          {p.mismatch && p.expected && <tr><td>Previously</td><td className="mono">{p.expected}</td></tr>}
        </tbody>
      </table>
      <div className="modal-actions">
        <button className="btn" autoFocus onClick={() => p.resolve(false)}>Cancel</button>
        <button className={`btn ${p.mismatch ? 'danger' : 'primary'}`} onClick={() => p.resolve(true)}>{p.mismatch ? 'Replace key and connect' : 'Trust and connect'}</button>
      </div>
    </Modal>
  )
}
