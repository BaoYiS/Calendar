import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, type RemoteEventSummary } from '../lib/api'
import { clearUser, useAuth } from '../lib/auth'
import { deleteEvent, useEvents } from '../lib/store'
import { datesSummary, timeRangeLabel } from '../lib/time'

export default function Home() {
  const events = useEvents()
  const navigate = useNavigate()
  const { status, user } = useAuth()
  const localList = Object.values(events).sort((a, b) => b.createdAt - a.createdAt)

  const [remoteList, setRemoteList] = useState<RemoteEventSummary[] | null>(null)
  const [remoteErr, setRemoteErr] = useState<string | null>(null)
  const [remoteTick, setRemoteTick] = useState(0)

  useEffect(() => {
    if (!user) {
      setRemoteList(null)
      setRemoteErr(null)
      return
    }
    let alive = true
    api
      .listEvents()
      .then(({ events: list }) => {
        if (alive) {
          setRemoteList(list)
          setRemoteErr(null)
        }
      })
      .catch((err) => {
        if (!alive) return
        if (err instanceof ApiError && err.status === 401) {
          // The session died server-side — drop to signed-out instead of lying.
          clearUser()
          return
        }
        // Keep whatever list we already had; an error is not an empty account.
        setRemoteErr("Couldn't reach the server — this list may be out of date.")
      })
    return () => {
      alive = false
    }
  }, [user, remoteTick])

  async function removeRemote(ev: RemoteEventSummary) {
    if (!window.confirm(`Delete "${ev.name}" and all its replies from the server?`)) return
    try {
      await api.deleteEvent(ev.id)
      setRemoteErr(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearUser()
        return
      }
      setRemoteErr(
        err instanceof ApiError ? err.message : `Could not delete "${ev.name}" — try again.`,
      )
    }
    setRemoteTick((t) => t + 1)
  }

  return (
    <div className="page">
      <section className="hero glass">
        <div className="hero-orbwrap" aria-hidden="true">
          <div className="hero-orb" />
          <div className="hero-ring" />
        </div>
        <h1 className="hero-title">Find the time that works for everyone</h1>
        <p className="hero-sub">
          Pick some days, share a link, and watch the best meeting time surface on a live
          availability heatmap. Sign in and your events live on the server — one link, replies
          from any device.
        </p>
        <div className="hero-actions">
          <Link to="/create" className="btn btn-primary btn-lg">
            Create an event
          </Link>
          {status === 'ready' && !user && (
            <Link to="/login" className="btn btn-ghost btn-lg">
              Sign in
            </Link>
          )}
        </div>
        {status === 'ready' && !user && (
          <p className="fineprint">
            No account? Events still work — they just stay in this browser.
          </p>
        )}
        <div className="hero-steps">
          <div className="step">
            <span className="step-num">1</span>
            <strong>Create</strong>
            <span>Choose the days and the daily time window that could work.</span>
          </div>
          <div className="step">
            <span className="step-num">2</span>
            <strong>Share</strong>
            <span>Send the invite link — everyone paints the times they're free.</span>
          </div>
          <div className="step">
            <span className="step-num">3</span>
            <strong>Decide</strong>
            <span>The heatmap glows brightest where the whole group overlaps.</span>
          </div>
        </div>
      </section>

      {user && (
        <section className="glass card">
          <div className="card-topline">
            <h2 className="card-title">Your events</h2>
            <span className="badge badge-aqua">{user.username}</span>
          </div>
          {remoteErr && (
            <div className="callout callout-warn" role="alert">
              {remoteErr}{' '}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setRemoteTick((t) => t + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {remoteList === null ? (
            !remoteErr && <p className="muted">Loading…</p>
          ) : remoteList.length === 0 ? (
            !remoteErr && (
              <p className="muted">
                Nothing here yet — create an event and it'll be saved to your account.
              </p>
            )
          ) : (
            <ul className="eventlist">
              {remoteList.map((ev) => (
                <li key={ev.id} className="eventrow">
                  <button
                    type="button"
                    className="eventrow-main"
                    onClick={() => navigate(`/event/${ev.id}`)}
                  >
                    <span className="eventrow-name">{ev.name}</span>
                    <span className="eventrow-meta">
                      {datesSummary(ev.dates)} · {timeRangeLabel(ev.startMinutes, ev.endMinutes)}
                    </span>
                  </button>
                  <span className={`badge ${ev.mine ? 'badge-aqua' : 'badge-dim'}`}>
                    {ev.mine ? 'organizer' : 'invited'}
                  </span>
                  <span className="badge badge-dim">
                    {ev.replyCount} {ev.replyCount === 1 ? 'reply' : 'replies'}
                  </span>
                  {ev.mine && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      aria-label={`Delete ${ev.name}`}
                      onClick={() => removeRemote(ev)}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {localList.length > 0 && (
        <section className="glass card">
          <div className="card-topline">
            <h2 className="card-title">{user ? 'On this browser only' : 'Your events'}</h2>
            {user && <span className="badge badge-dim">not on the server</span>}
          </div>
          {user && (
            <p className="fineprint">
              These were made without an account. Open one to move it to your account so its link
              works everywhere.
            </p>
          )}
          <ul className="eventlist">
            {localList.map((ev) => (
              <li key={ev.id} className="eventrow">
                <button
                  type="button"
                  className="eventrow-main"
                  onClick={() => navigate(`/event/${ev.id}`)}
                >
                  <span className="eventrow-name">{ev.name}</span>
                  <span className="eventrow-meta">
                    {datesSummary(ev.dates)} · {timeRangeLabel(ev.startMinutes, ev.endMinutes)}
                  </span>
                </button>
                <span className={`badge ${ev.role === 'organizer' ? 'badge-aqua' : 'badge-dim'}`}>
                  {ev.role === 'organizer' ? 'organizer' : 'invited'}
                </span>
                <span className="badge badge-dim">
                  {ev.responses.length} {ev.responses.length === 1 ? 'reply' : 'replies'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label={`Delete ${ev.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete "${ev.name}" and its responses from this browser?`)) {
                      deleteEvent(ev.id)
                    }
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
