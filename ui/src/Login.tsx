import { useState } from 'react'
import { api } from './api'
import type { User } from './types'

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [needOtp, setNeedOtp] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { onLogin(await api.post('/api/auth/login', { username, password, otp: needOtp ? otp : undefined })) }
    catch (err: any) {
      if (err.data?.mfa_required) { setNeedOtp(true); if (needOtp) setError(err.message) }
      else setError(err.message)
    } finally { setBusy(false) }
  }
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">&gt;_ CodeFromHere</div>
        {!needOtp ? <>
          <input className="input" autoFocus autoComplete="username" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        </> : (
          <input className="input otp" autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={otp} onChange={e => setOtp(e.target.value)} />
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>{needOtp ? 'Verify' : 'Sign in'}</button>
      </form>
    </div>
  )
}
