import { Link, useNavigate } from 'react-router-dom'
import { deleteEvent, useEvents } from '../lib/store'
import { datesSummary, timeRangeLabel } from '../lib/time'

export default function Home() {
  const events = useEvents()
  const navigate = useNavigate()
  const list = Object.values(events).sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="page">
      <section className="hero glass">
        <div className="hero-orb" aria-hidden="true" />
        <h1 className="hero-title">Find the time that works for everyone</h1>
        <p className="hero-sub">
          Pick some days, share a link, and watch the best meeting time surface on a live
          availability heatmap. No accounts, no sign-ups — it all lives right in the browser.
        </p>
        <div className="hero-actions">
          <Link to="/create" className="btn btn-primary btn-lg">
            Create an event
          </Link>
        </div>
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

      {list.length > 0 && (
        <section className="glass card">
          <h2 className="card-title">Your events</h2>
          <ul className="eventlist">
            {list.map((ev) => (
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
