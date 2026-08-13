import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import CopyField from '../components/CopyField'
import TimeGrid from '../components/TimeGrid'
import { bestTimes } from '../lib/analyze'
import { heatGradientCSS } from '../lib/heat'
import { decodeEventDef, decodeResponse, respondUrl } from '../lib/share'
import { deleteEvent, importEventDef, removeResponse, upsertResponse, useEvents } from '../lib/store'
import { dateLabel, datesSummary, localTimezone, timeLabel, timeRangeLabel } from '../lib/time'

export default function EventPage() {
  const { id = '' } = useParams()
  const events = useEvents()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const ev = events[id]

  const encoded = params.get('d')
  useEffect(() => {
    if (!ev && encoded) {
      const def = decodeEventDef(encoded)
      if (def && def.id === id) importEventDef(def)
    }
  }, [ev, encoded, id])

  const [importCode, setImportCode] = useState('')
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const best = useMemo(() => (ev ? bestTimes(ev, ev.responses, 5) : []), [ev])

  // A valid ?d= payload is about to be imported by the effect above — render
  // nothing for that frame instead of flashing the not-found card.
  const pendingImport = useMemo(
    () => !ev && !!encoded && decodeEventDef(encoded)?.id === id,
    [ev, encoded, id],
  )

  if (!ev) {
    if (pendingImport) return null
    return (
      <div className="page">
        <div className="glass card">
          <h1 className="card-title">Event not found</h1>
          <p className="muted">
            This event isn't stored in this browser, and the link doesn't carry its details.
            Ask the organizer to send you the full invite link.
          </p>
          <div className="card-actions">
            <Link to="/" className="btn btn-primary">
              Back home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const tz = localTimezone()
  const inviteLink = respondUrl(ev)

  function runImport() {
    if (!ev) return
    const decoded = decodeResponse(ev, importCode)
    if (!decoded || decoded.name === '') {
      setImportMsg({ ok: false, text: "That code doesn't match this event — check it was copied fully." })
      return
    }
    const previous = ev.responses.find((r) => r.id === decoded.name.toLowerCase())
    upsertResponse(ev.id, decoded.name, decoded.slots)
    setImportMsg({
      ok: true,
      text: previous
        ? `Updated ${decoded.name}'s availability (was ${previous.slots.length} slots, now ${decoded.slots.length}).`
        : `Added ${decoded.name}'s availability (${decoded.slots.length} slots).`,
    })
    setImportCode('')
  }

  return (
    <div className="page">
      <section className="glass card">
        <div className="card-topline">
          <h1 className="card-title">{ev.name}</h1>
          <span className={`badge ${ev.role === 'organizer' ? 'badge-aqua' : 'badge-dim'}`}>
            {ev.role === 'organizer' ? 'organizer' : 'invited'}
          </span>
        </div>
        {ev.description && <p className="muted">{ev.description}</p>}
        <div className="chips">
          <span className="chip">{datesSummary(ev.dates)}</span>
          <span className="chip">{timeRangeLabel(ev.startMinutes, ev.endMinutes)}</span>
          <span className="chip">{ev.slotMinutes}-minute slots</span>
          {ev.timezone !== tz && <span className="chip chip-warn">times in {ev.timezone}</span>}
        </div>
        <div className="card-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/respond/${ev.id}`)}>
            Add / edit my availability
          </button>
        </div>
      </section>

      <section className="glass card">
        <h2 className="card-title">Invite people</h2>
        <p className="muted">
          Anyone with this link can paint their availability — no account needed.
        </p>
        <CopyField value={inviteLink} label="Invite link" />
        <details className="import-details">
          <summary>Got a response code from someone?</summary>
          <p className="muted">
            When someone fills this in on another device, they get a short response code.
            Paste it here to add their availability to your results.
          </p>
          <div className="importrow">
            <input
              className="input"
              value={importCode}
              onChange={(e) => {
                setImportCode(e.target.value)
                setImportMsg(null)
              }}
              placeholder="Paste a response code…"
              aria-label="Response code"
            />
            <button type="button" className="btn btn-mint" onClick={runImport} disabled={importCode.trim() === ''}>
              Import
            </button>
          </div>
          {importMsg && (
            <div className={`callout ${importMsg.ok ? 'callout-ok' : 'callout-warn'}`} role="status">
              {importMsg.text}
            </div>
          )}
        </details>
      </section>

      <section className="glass card">
        <div className="card-topline">
          <h2 className="card-title">Group availability</h2>
          <span className="badge badge-dim">
            {ev.responses.length} {ev.responses.length === 1 ? 'reply' : 'replies'}
          </span>
        </div>

        {ev.responses.length === 0 ? (
          <div className="empty">
            <div className="empty-orb" aria-hidden="true" />
            <p>No replies yet. Add your own availability to get things rolling, then share the link.</p>
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/respond/${ev.id}`)}>
              I'll go first
            </button>
          </div>
        ) : (
          <>
            <div className="chips people">
              {ev.responses.map((r) => (
                <span key={r.id} className="chip chip-person">
                  <button
                    type="button"
                    className="chip-name"
                    title={`Edit ${r.name}'s availability`}
                    onClick={() => navigate(`/respond/${ev.id}?name=${encodeURIComponent(r.name)}`)}
                  >
                    {r.name}
                  </button>
                  <span className="chip-sub">{r.slots.length}</span>
                  <button
                    type="button"
                    className="chip-x"
                    aria-label={`Remove ${r.name}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${r.name}'s availability?`)) removeResponse(ev.id, r.id)
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            <TimeGrid def={ev} mode="heat" responses={ev.responses} />

            <div className="legend" aria-hidden="true">
              <span className="legend-label">nobody free</span>
              <span className="legend-bar" style={{ background: heatGradientCSS() }} />
              <span className="legend-label">all {ev.responses.length} free</span>
            </div>

            {best.length > 0 && (
              <div className="besttimes">
                <h3 className="besttimes-title">Best times</h3>
                <ol className="besttimes-list">
                  {best.map((b, i) => {
                    const l = dateLabel(b.date)
                    return (
                      <li key={`${b.date}-${b.startMin}`} className="bestrow">
                        <span className={`bestrank${i === 0 ? ' bestrank-top' : ''}`}>{i + 1}</span>
                        <span className="bestwhen">
                          <strong>
                            {l.dow}, {l.md}
                          </strong>{' '}
                          {timeLabel(b.startMin)} – {timeLabel(b.endMin)}
                        </span>
                        <span className="bestcount">
                          {b.count}/{ev.responses.length} free
                        </span>
                        <span className="bestnames">{b.names.join(', ')}</span>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}
          </>
        )}
      </section>

      <div className="page-footer-actions">
        <button
          type="button"
          className="btn btn-ghost btn-danger"
          onClick={() => {
            if (window.confirm(`Delete "${ev.name}" and all its responses from this browser?`)) {
              deleteEvent(ev.id)
              navigate('/')
            }
          }}
        >
          Delete this event
        </button>
      </div>
    </div>
  )
}
