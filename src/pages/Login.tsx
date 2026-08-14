import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { login, register, useAuth } from '../lib/auth'

export default function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [mode, setMode] = useState<'signin' | 'register'>(
    params.get('mode') === 'register' ? 'register' : 'signin',
  )
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const nextParam = params.get('next')
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signin') await login(username.trim(), password)
      else await register(username.trim(), password)
      navigate(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again.')
    } finally {
      setBusy(false)
    }
  }

  if (user) {
    return (
      <div className="page">
        <div className="glass card auth-card">
          <h1 className="card-title">You're signed in</h1>
          <p className="muted">
            Signed in as <strong>{user.username}</strong>. Your events are stored on the server
            and your invite links work from any device.
          </p>
          <div className="card-actions">
            <Link to="/" className="btn btn-primary">
              Back home
            </Link>
            <Link to="/create" className="btn btn-mint">
              Create an event
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <form className="glass card auth-card" onSubmit={submit}>
        <h1 className="card-title">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted">
          With an account your events live on the server — share one link and watch replies land
          from any device, no copy-paste codes needed.
        </p>

        <div className="segmented" role="group" aria-label="Sign in or create account">
          <button
            type="button"
            aria-pressed={mode === 'signin'}
            className={`seg${mode === 'signin' ? ' seg-on' : ''}`}
            onClick={() => {
              setMode('signin')
              setError(null)
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            aria-pressed={mode === 'register'}
            className={`seg${mode === 'register' ? ' seg-on' : ''}`}
            onClick={() => {
              setMode('register')
              setError(null)
            }}
          >
            Create account
          </button>
        </div>

        <label className="field">
          <span className="field-label">Username</span>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="letters, digits, - or _"
            maxLength={24}
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder={mode === 'register' ? 'at least 8 characters' : ''}
          />
        </label>

        {error && (
          <div className="callout callout-warn" role="alert">
            {error}
          </div>
        )}

        <div className="card-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'One sec…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <Link to="/" className="btn btn-ghost">
            Continue without an account
          </Link>
        </div>
        <p className="fineprint">
          No email needed. Without an account, events stay in this browser only.
        </p>
      </form>
    </div>
  )
}
