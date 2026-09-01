import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import CopyField from '../components/CopyField'
import TimeGrid from '../components/TimeGrid'
import TimezonePicker from '../components/TimezonePicker'
import { ApiError, api } from '../lib/api'
import { refreshAuth, useAuth } from '../lib/auth'
import { eventMode, MODE_COPY } from '../lib/modes'
import { useRemoteEvent } from '../lib/remote'
import { decodeEventDef, encodeResponse } from '../lib/share'
import { importEventDef, upsertResponse, useEvents } from '../lib/store'
import { datesSummary, slotKey, slotRows } from '../lib/time'
import { columnShift, shiftedRange, useViewTimezone } from '../lib/tz'
import type { ResponseEntry } from '../types'

export default function Respond() {
  const { id = '' } = useParams()
  const events = useEvents()
  const [params] = useSearchParams()
  const { user } = useAuth()

  // Server first (primary), browser storage as the fallback.
  const { remote, loading: remoteLoading, refresh } = useRemoteEvent(id, 0)
  const local = events[id]
  const ev = remote ?? local
  const isRemote = !!remote

  const encoded = params.get('d')
  useEffect(() => {
    if (!ev && !remoteLoading && encoded) {
      const def = decodeEventDef(encoded)
      if (def && def.id === id) importEventDef(def)
    }
  }, [ev, remoteLoading, encoded, id])

  const [name, setName] = useState(() => params.get('name') ?? '')
  const [slots, setSlots] = useState<Set<string>>(new Set())
  const [savedCode, setSavedCode] = useState<string | null>(null)
  const [savedRemote, setSavedRemote] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewTz, setViewTz] = useViewTimezone()
  const dirty = useRef(false)
  const loadedFor = useRef<string | null>(null)
  const prefilled = useRef(false)

  // Signed-in users get their username prefilled as the display name.
  useEffect(() => {
    if (user && !prefilled.current && name.trim() === '' && !params.get('name')) {
      prefilled.current = true
      setName(user.username)
    }
  }, [user, name, params])

  const nameKey = name.trim().toLowerCase()
  // Identity string for dirty/loaded bookkeeping (never sent to the server).
  const myKey = isRemote ? (user ? `u:${user.id}` : nameKey ? `g:${nameKey}` : '') : nameKey
  // Server events expose only opaque reply ids, so match by the safe flags:
  // the viewer's account reply carries `self`; guests match by display name.
  const guestMatch =
    isRemote && nameKey !== ''
      ? ev?.responses.find((r) => !r.registered && r.name.trim().toLowerCase() === nameKey)
      : undefined
  const existing = isRemote
    ? user
      ? ev?.responses.find((r) => r.self)
      : guestMatch
    : ev?.responses.find((r) => r.id === nameKey)
  // Signed in with no account reply yet, but a guest reply under this name:
  // saving absorbs it into the account (the server removes the guest entry).
  const claimable = isRemote && user && !existing ? guestMatch : undefined

  const evMode = ev ? eventMode(ev) : 'overlap'
  const copy = MODE_COPY[evMode]
  const exclusive = evMode === 'exclusive'

  /** Replies that count as "mine" — same rules the existing/claimable match uses. */
  function ownReplyIds(rs: ResponseEntry[]): Set<string> {
    const ids = new Set<string>()
    for (const r of rs) {
      const guestNameMatch = !r.registered && r.name.trim().toLowerCase() === nameKey
      const own = isRemote ? (user ? !!r.self || guestNameMatch : guestNameMatch) : r.id === nameKey
      if (own) ids.add(r.id)
    }
    return ids
  }

  // Mutually-exclusive events: slots other people hold are off-limits.
  const takenBy = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!ev || !exclusive) return map
    const own = ownReplyIds(ev.responses)
    for (const r of ev.responses) {
      if (own.has(r.id)) continue
      for (const s of r.slots) {
        const arr = map.get(s)
        if (arr) arr.push(r.name)
        else map.set(s, [r.name])
      }
    }
    return map
  }, [ev, exclusive, nameKey, user, isRemote])

  // When the identity matches a saved reply, load it — but never clobber
  // in-progress painting.
  useEffect(() => {
    if (!ev || myKey === loadedFor.current) return
    if (dirty.current) return
    loadedFor.current = myKey
    const match = existing ?? claimable
    setSlots(new Set(match?.slots ?? []))
    if (match && isRemote) setName(match.name)
  }, [ev, myKey, existing, claimable, isRemote])

  const allSlots = useMemo(() => {
    if (!ev) return new Set<string>()
    const rows = slotRows(ev)
    const all = new Set<string>()
    for (const d of ev.dates) for (const m of rows) all.add(slotKey(d, m))
    return all
  }, [ev])

  // What "Select all" may grab — everything except other people's slots.
  const selectableSlots = useMemo(() => {
    if (takenBy.size === 0) return allSlots
    return new Set([...allSlots].filter((s) => !takenBy.has(s)))
  }, [allSlots, takenBy])

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
            This invite isn't on the server or in this browser. Check the link is complete — or
            ask the organizer to re-send it.
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

  function paint(next: Set<string>) {
    dirty.current = true
    setSlots(next)
    setSavedCode(null)
    setSavedRemote(false)
  }

  async function save() {
    if (!ev || busy) return
    // Exclusive events: catch stale picks before they leave this device (the
    // server re-checks for remote events; local events have no other referee).
    if (exclusive) {
      const clashes = [...slots].filter((s) => takenBy.has(s))
      if (clashes.length > 0) {
        setSaveErr(
          `${clashes.length === 1 ? 'One of your marked times is' : `${clashes.length} of your marked times are`} already taken — unmark the greyed-out slots and save again.`,
        )
        return
      }
    }
    if (isRemote) {
      setBusy(true)
      setSaveErr(null)
      try {
        await api.respond(ev.id, name.trim(), [...slots], user?.id)
        dirty.current = false
        loadedFor.current = myKey
        setSavedRemote(true)
        refresh()
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && user) {
          // The session died under us — sync the auth store (drops the UI to
          // guest mode) and explain, instead of silently mis-keying the reply.
          await refreshAuth()
          setSaveErr(
            'Your session has ended, so nothing was saved. Sign in again to reply from your account — or just save again to reply as a guest.',
          )
        } else if (err instanceof ApiError && err.status === 409 && exclusive) {
          // Someone claimed slots between our load and save. Fetch the fresh
          // event, unmark what's now theirs, and let the user re-save.
          try {
            const { event } = await api.getEvent(ev.id)
            const own = ownReplyIds(event.responses)
            const taken = new Set<string>()
            for (const r of event.responses) {
              if (!own.has(r.id)) for (const s of r.slots) taken.add(s)
            }
            const keep = [...slots].filter((s) => !taken.has(s))
            const dropped = slots.size - keep.length
            setSlots(new Set(keep))
            dirty.current = true
            refresh()
            setSaveErr(
              `${err.message}${dropped > 0 ? ` ${dropped === 1 ? 'That time has' : 'Those times have'} been unmarked — review and save again.` : ' Refresh and try again.'}`,
            )
          } catch {
            setSaveErr(err.message)
          }
        } else {
          setSaveErr(err instanceof ApiError ? err.message : 'Could not reach the server — try again.')
        }
      } finally {
        setBusy(false)
      }
      return
    }
    upsertResponse(ev.id, name, [...slots])
    dirty.current = false
    setSavedCode(encodeResponse(ev, name.trim(), [...slots]))
  }

  const canSave = name.trim() !== ''

  return (
    <div className="page">
      <section className="glass card">
        <div className="card-topline">
          <h1 className="card-title">{ev.name}</h1>
          <span className="chips">
            {isRemote && <span className="badge badge-mint">on the server</span>}
            <Link to={`/event/${ev.id}`} className="btn btn-ghost btn-sm">
              View results
            </Link>
          </span>
        </div>
        {ev.description && <p className="muted">{ev.description}</p>}
        <div className="chips">
          {evMode !== 'overlap' && <span className="chip">{copy.label.toLowerCase()}</span>}
          <span className="chip">{datesSummary(ev.dates)}</span>
          <span className="chip">
            {(() => {
              const shift0 = columnShift(ev.dates[0], ev.startMinutes, ev.timezone, viewTz)
              return shiftedRange(ev.startMinutes + shift0, ev.endMinutes + shift0)
            })()}
          </span>
        </div>
        <TimezonePicker eventTz={ev.timezone} value={viewTz} onChange={setViewTz} />

        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input input-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="So the group knows who's free"
            maxLength={40}
          />
        </label>
        {isRemote && !user && (
          <p className="fineprint">
            Replying as a guest — your reply is keyed to this name.{' '}
            <Link to={`/login?next=/respond/${ev.id}`}>Sign in</Link> (keeping the same name) to
            make it yours and edit it from any device.
          </p>
        )}
        {claimable && (
          <p className="fineprint">
            You replied to this earlier as a guest — saving will attach that reply to your
            account.
          </p>
        )}
        {existing && !dirty.current && slots.size > 0 && (
          <p className="fineprint">
            Loaded {existing.name}'s saved reply — edit away and save to update it.
          </p>
        )}
        {existing && dirty.current && loadedFor.current !== myKey && (
          <div className="callout callout-warn" role="status">
            {existing.name} already has a saved reply ({existing.slots.length} slot
            {existing.slots.length === 1 ? '' : 's'}) — saving now will replace it.{' '}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                loadedFor.current = myKey
                dirty.current = false
                setSavedCode(null)
                setSavedRemote(false)
                setSlots(new Set(existing.slots))
              }}
            >
              Load their reply instead
            </button>
          </div>
        )}

        <div className="paint-toolbar">
          <span className="paint-hint">
            Click or drag to {copy.paintHint} · {slots.size} slot{slots.size === 1 ? '' : 's'} marked
          </span>
          <div className="paint-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => paint(new Set(selectableSlots))}
            >
              Select all
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-disabled={slots.size === 0}
              onClick={() => {
                if (slots.size > 0) paint(new Set())
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <TimeGrid
          def={ev}
          mode="paint"
          value={slots}
          onChange={paint}
          takenBy={exclusive ? takenBy : undefined}
          viewTz={viewTz}
        />

        {saveErr && (
          <div className="callout callout-warn" role="alert">
            {saveErr}
          </div>
        )}

        <div className="card-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={save}
            disabled={!canSave || busy}
          >
            {busy
              ? 'Saving…'
              : existing || claimable
                ? `Update my ${copy.noun}`
                : `Save my ${copy.noun}`}
          </button>
          {!canSave && <span className="fineprint">Add your name to save.</span>}
        </div>
      </section>

      {savedRemote && (
        <section className="glass card callout-ok-card" role="status">
          <h2 className="card-title">Saved ✓</h2>
          <p className="muted">
            Your reply is saved to the event — the organizer and everyone else can see it
            immediately. No codes, nothing to send.
          </p>
          <div className="card-actions">
            <Link to={`/event/${ev.id}`} className="btn btn-mint">
              {copy.resultsCta}
            </Link>
          </div>
        </section>
      )}

      {savedCode && !isRemote && (
        <section className="glass card callout-ok-card" role="status">
          <h2 className="card-title">Saved ✓</h2>
          <p className="muted">
            Your reply is stored in this browser and already counts toward the results here.{' '}
            <strong>Filling this in on your own device?</strong> Send the organizer this
            response code so they can import it into their results:
          </p>
          <CopyField value={savedCode} label="Response code" />
          <div className="card-actions">
            <Link to={`/event/${ev.id}`} className="btn btn-mint">
              {copy.resultsCta}
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
