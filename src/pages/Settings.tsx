import { useState } from 'react'
import { Link } from 'react-router-dom'
import TimezoneSelect from '../components/TimezoneSelect'
import { ApiError } from '../lib/api'
import { clearUser, updateSettings, useAuth } from '../lib/auth'
import { localTimezone } from '../lib/time'
import { offsetBadge } from '../lib/tz'

export default function Settings() {
  const { status, user } = useAuth()
  // null = showing the stored value; a string is an unsaved edit.
  const [edited, setEdited] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') {
    return (
      <div className="page">
        <div className="glass card auth-card">
          <h1 className="card-title">Settings</h1>
          <p className="muted">One sec…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="page">
        <div className="glass card auth-card">
          <h1 className="card-title">Settings</h1>
          <p className="muted">Settings live on your account, so there's nothing to change while
            signed out — guest events always use this device's timezone.</p>
          <div className="card-actions">
            <Link to="/login?next=/settings" className="btn btn-primary">
              Sign in
            </Link>
            <Link to="/" className="btn btn-ghost">
              Back home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const stored = user.defaultTimezone
  const value = edited ?? stored ?? localTimezone()
  const dirty = value !== stored

  function pick(tz: string) {
    setEdited(tz)
    setSaved(false)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !dirty) return
    setBusy(true)
    setError(null)
    try {
      await updateSettings({ defaultTimezone: value })
      setEdited(null)
      setSaved(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Session died under us — flip the whole page to the sign-in prompt.
        clearUser()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not reach the server — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <form className="glass card auth-card" onSubmit={save}>
        <h1 className="card-title">Settings</h1>
        <p className="muted">
          Signed in as <strong>{user.username}</strong>.
        </p>

        <div className="field">
          <label className="field-label" htmlFor="settings-tz">
            Default timezone
          </label>
          <div className="tzpicker-row">
            <TimezoneSelect id="settings-tz" value={value} onChange={pick} />
            <span className="badge badge-dim tzpicker-offset">{offsetBadge(value)}</span>
            {value !== localTimezone() && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => pick(localTimezone())}
              >
                Device timezone
              </button>
            )}
          </div>
          <p className="fineprint">
            New events start in this timezone.
            {stored === null &&
              ` Your account has no stored default yet, so event creation currently falls back to
              this device's timezone (${localTimezone()}) — save one here to pin it.`}{' '}
            Changing it doesn't touch events you've already created.
          </p>
        </div>

        {error && (
          <div className="callout callout-warn" role="alert">
            {error}
          </div>
        )}
        {saved && !dirty && (
          <div className="callout callout-ok" role="status">
            Saved — new events will start in {value}.
          </div>
        )}

        <div className="card-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
