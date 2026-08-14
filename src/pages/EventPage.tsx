import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import CopyField from '../components/CopyField'
import TimeGrid from '../components/TimeGrid'
import TimezonePicker from '../components/TimezonePicker'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { bestTimes } from '../lib/analyze'
import { heatGradientCSS } from '../lib/heat'
import { useRemoteEvent } from '../lib/remote'
import { decodeEventDef, decodeResponse, respondUrl } from '../lib/share'
import {
  deleteEvent,
  importEventDef,
  removeResponse,
  upsertResponse,
  useEvents,
} from '../lib/store'
import { dateLabel, datesSummary } from '../lib/time'
import { addDays, columnShift, shiftedRange, useViewTimezone } from '../lib/tz'

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Could not reach the server — try again.'
}

export default function EventPage() {
  const { id = '' } = useParams()
  const events = useEvents()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { status: authStatus, user } = useAuth()

  // Server first (primary), browser storage as the fallback.
  const { remote, loading: remoteLoading, refresh } = useRemoteEvent(id, 12000)
  const local = events[id]
  const ev = remote ?? local
  const isRemote = !!remote

  // Re-ask the server after sign-in/out so `mine` and `self` flags un-stale.
  // (Skip the mount run — the hook already fetches once on its own.)
  const userId = user?.id
  const authSeen = useRef(false)
  useEffect(() => {
    if (!authSeen.current) {
      authSeen.current = true
      return
    }
    refresh()
  }, [userId, refresh])

  const encoded = params.get('d')
  useEffect(() => {
    if (!ev && !remoteLoading && encoded) {
      const def = decodeEventDef(encoded)
      if (def && def.id === id) importEventDef(def)
    }
  }, [ev, remoteLoading, encoded, id])

  const [importCode, setImportCode] = useState('')
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [viewTz, setViewTz] = useViewTimezone()

  const best = useMemo(() => (ev ? bestTimes(ev, ev.responses, 5) : []), [ev])

  // A valid ?d= payload is about to be imported by the effect above — render
  // the loading state for that frame instead of flashing the not-found card.
  const pendingImport = useMemo(
    () => !ev && !!encoded && decodeEventDef(encoded)?.id === id,
    [ev, encoded, id],
  )

  if (!ev) {
    if (remoteLoading || pendingImport) {
      return (
        <div className="page">
          <div className="glass card loading-card">
            <div className="empty-orb orb-pulse" aria-hidden="true" />
            <p className="muted">Fetching event…</p>
          </div>
        </div>
      )
    }
    return (
      <div className="page">
        <div className="glass card">
          <h1 className="card-title">Event not found</h1>
          <p className="muted">
            This event isn't on the server or in this browser. Check the invite link is complete —
            or ask the organizer to send it again.
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

  // `mine` was answered for the session the fetch used; once signed out it is
  // stale until the next poll, so gate it on auth. ('loading' passes so the
  // organizer badge doesn't flicker on first paint while /me is in flight.)
  const isOrganizer = isRemote
    ? remote.mine && (authStatus !== 'ready' || !!user)
    : local?.role === 'organizer'
  const inviteLink = isRemote
    ? `${location.origin}${location.pathname}#/respond/${ev.id}`
    : respondUrl(ev)
  const shift0 = columnShift(ev.dates[0], ev.startMinutes, ev.timezone, viewTz)

  function runImport() {
    if (!ev || isRemote) return
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

  async function removeReply(rid: string, rname: string) {
    if (!window.confirm(`Remove ${rname}'s availability?`)) return
    if (isRemote) {
      try {
        await api.removeResponse(id, rid)
        setActionErr(null)
        refresh()
      } catch (err) {
        setActionErr(errText(err))
      }
    } else {
      removeResponse(id, rid)
    }
  }

  async function deleteWholeEvent() {
    const scope = isRemote ? 'from the server for everyone' : 'from this browser'
    if (!window.confirm(`Delete "${ev?.name}" and all its responses ${scope}?`)) return
    if (isRemote) {
      try {
        await api.deleteEvent(id)
        navigate('/')
      } catch (err) {
        setActionErr(errText(err))
      }
    } else {
      deleteEvent(id)
      navigate('/')
    }
  }

  /** Re-create a browser-only event on the server, replies included. */
  async function moveToAccount() {
    if (!local || !user || moveBusy) return
    setMoveBusy(true)
    try {
      const { event } = await api.createEvent({
        name: local.name,
        description: local.description,
        dates: local.dates,
        startMinutes: local.startMinutes,
        endMinutes: local.endMinutes,
        slotMinutes: local.slotMinutes,
        timezone: local.timezone,
        responses: local.responses.map((r) => ({ name: r.name, slots: r.slots })),
        movedFrom: local.id,
      })
      // Delete the browser copy only if every reply survived the import;
      // otherwise roll the server copy back and keep the local data.
      if (event.responses.length !== local.responses.length) {
        try {
          await api.deleteEvent(event.id)
        } catch {
          // Best-effort rollback.
        }
        setActionErr(
          `Only ${event.responses.length} of ${local.responses.length} replies could be imported, so the browser copy was kept.`,
        )
        return
      }
      deleteEvent(local.id)
      navigate(`/event/${event.id}`)
    } catch (err) {
      setActionErr(errText(err))
    } finally {
      setMoveBusy(false)
    }
  }

  const canRemoveReply = (r: { id: string; self?: boolean }) =>
    isRemote ? isOrganizer || !!r.self : true

  return (
    <div className="page">
      <section className="glass card">
        <div className="card-topline">
          <h1 className="card-title">{ev.name}</h1>
          <span className="chips">
            {isRemote && <span className="badge badge-mint">on the server</span>}
            <span className={`badge ${isOrganizer ? 'badge-aqua' : 'badge-dim'}`}>
              {isOrganizer ? 'organizer' : 'invited'}
            </span>
          </span>
        </div>
        {ev.description && <p className="muted">{ev.description}</p>}
        <div className="chips">
          <span className="chip">{datesSummary(ev.dates)}</span>
          <span className="chip">{shiftedRange(ev.startMinutes + shift0, ev.endMinutes + shift0)}</span>
          <span className="chip">{ev.slotMinutes}-minute slots</span>
          {isRemote && !remote.mine && <span className="chip">hosted by {remote.ownerName}</span>}
        </div>
        <TimezonePicker eventTz={ev.timezone} value={viewTz} onChange={setViewTz} />
        <div className="card-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/respond/${ev.id}`)}>
            Add / edit my availability
          </button>
        </div>
      </section>

      <section className="glass card">
        <h2 className="card-title">Invite people</h2>
        {isRemote ? (
          <p className="muted">
            Anyone with this link can reply from any device — no account needed. Replies land
            here automatically.
          </p>
        ) : (
          <p className="muted">Anyone with this link can paint their availability — no account needed.</p>
        )}
        <CopyField value={inviteLink} label="Invite link" />

        {!isRemote && user && local?.role === 'organizer' && (
          <div className="callout callout-warn">
            This event lives only in this browser, so replies from other devices arrive as
            copy-paste codes.{' '}
            <button type="button" className="btn btn-mint btn-sm" onClick={moveToAccount} disabled={moveBusy}>
              {moveBusy ? 'Moving…' : 'Move it to my account'}
            </button>{' '}
            to get a link that collects replies by itself. Links you've already sent keep
            working after the move — only response codes generated before it stop being
            importable.
          </div>
        )}

        {!isRemote && (
          <details className="import-details">
            <summary>Got a response code from someone?</summary>
            <p className="muted">
              When someone fills this in on another device, they get a short response code. Paste
              it here to add their availability to your results.
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
              <button
                type="button"
                className="btn btn-mint"
                onClick={runImport}
                disabled={importCode.trim() === ''}
              >
                Import
              </button>
            </div>
            {importMsg && (
              <div className={`callout ${importMsg.ok ? 'callout-ok' : 'callout-warn'}`} role="status">
                {importMsg.text}
              </div>
            )}
          </details>
        )}
      </section>

      <section className="glass card">
        <div className="card-topline">
          <h2 className="card-title">Group availability</h2>
          <span className="chips">
            {isRemote && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>
                Refresh
              </button>
            )}
            <span className="badge badge-dim">
              {ev.responses.length} {ev.responses.length === 1 ? 'reply' : 'replies'}
            </span>
          </span>
        </div>

        {actionErr && (
          <div className="callout callout-warn" role="alert">
            {actionErr}
          </div>
        )}

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
                  {!isRemote ? (
                    <button
                      type="button"
                      className="chip-name"
                      title={`Edit ${r.name}'s availability`}
                      onClick={() => navigate(`/respond/${ev.id}?name=${encodeURIComponent(r.name)}`)}
                    >
                      {r.name}
                    </button>
                  ) : (
                    <span className="chip-name-static">
                      {r.name}
                      {r.registered ? '' : ' (guest)'}
                    </span>
                  )}
                  <span className="chip-sub">{r.slots.length}</span>
                  {canRemoveReply(r) && (
                    <button
                      type="button"
                      className="chip-x"
                      aria-label={`Remove ${r.name}`}
                      onClick={() => removeReply(r.id, r.name)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>

            <TimeGrid def={ev} mode="heat" responses={ev.responses} viewTz={viewTz} />

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
                    const shift = columnShift(b.date, ev.startMinutes, ev.timezone, viewTz)
                    const cs = b.startMin + shift
                    const l = dateLabel(addDays(b.date, Math.floor(cs / 1440)))
                    return (
                      <li key={`${b.date}-${b.startMin}`} className="bestrow">
                        <span className={`bestrank${i === 0 ? ' bestrank-top' : ''}`}>{i + 1}</span>
                        <span className="bestwhen">
                          <strong>
                            {l.dow}, {l.md}
                          </strong>{' '}
                          {shiftedRange(cs, b.endMin + shift)}
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

      {(isOrganizer || !isRemote) && (
        <div className="page-footer-actions page-footer-column">
          {actionErr && <div className="callout callout-warn">{actionErr}</div>}
          <button type="button" className="btn btn-ghost btn-danger" onClick={deleteWholeEvent}>
            Delete this event
          </button>
        </div>
      )}
    </div>
  )
}
