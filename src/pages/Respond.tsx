import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import CopyField from '../components/CopyField'
import TimeGrid from '../components/TimeGrid'
import { decodeEventDef, encodeResponse } from '../lib/share'
import { importEventDef, upsertResponse, useEvents } from '../lib/store'
import { datesSummary, slotKey, slotRows, timeRangeLabel } from '../lib/time'

export default function Respond() {
  const { id = '' } = useParams()
  const events = useEvents()
  const [params] = useSearchParams()
  const ev = events[id]

  const encoded = params.get('d')
  useEffect(() => {
    if (!ev && encoded) {
      const def = decodeEventDef(encoded)
      if (def && def.id === id) importEventDef(def)
    }
  }, [ev, encoded, id])

  const [name, setName] = useState(() => params.get('name') ?? '')
  const [slots, setSlots] = useState<Set<string>>(new Set())
  const [savedCode, setSavedCode] = useState<string | null>(null)
  const dirty = useRef(false)
  const loadedFor = useRef<string | null>(null)

  const nameKey = name.trim().toLowerCase()
  const existing = ev?.responses.find((r) => r.id === nameKey)

  // When the typed name matches a saved reply, load it — but never clobber
  // in-progress painting.
  useEffect(() => {
    if (!ev || nameKey === loadedFor.current) return
    if (dirty.current) return
    loadedFor.current = nameKey
    const match = ev.responses.find((r) => r.id === nameKey)
    setSlots(new Set(match?.slots ?? []))
  }, [ev, nameKey])

  const allSlots = useMemo(() => {
    if (!ev) return new Set<string>()
    const rows = slotRows(ev)
    const all = new Set<string>()
    for (const d of ev.dates) for (const m of rows) all.add(slotKey(d, m))
    return all
  }, [ev])

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
            This invite isn't stored in this browser and the link doesn't carry the event
            details. Ask the organizer to re-send the full invite link.
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
  }

  function save() {
    if (!ev) return
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
          <Link to={`/event/${ev.id}`} className="btn btn-ghost btn-sm">
            View results
          </Link>
        </div>
        {ev.description && <p className="muted">{ev.description}</p>}
        <div className="chips">
          <span className="chip">{datesSummary(ev.dates)}</span>
          <span className="chip">{timeRangeLabel(ev.startMinutes, ev.endMinutes)}</span>
        </div>

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
        {existing && !dirty.current && slots.size > 0 && (
          <p className="fineprint">
            Loaded {existing.name}'s saved reply — edit away and save to update it.
          </p>
        )}
        {existing && dirty.current && loadedFor.current !== nameKey && (
          <div className="callout callout-warn" role="status">
            {existing.name} already has a saved reply ({existing.slots.length} slot
            {existing.slots.length === 1 ? '' : 's'}) — saving now will replace it.{' '}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                loadedFor.current = nameKey
                dirty.current = false
                setSavedCode(null)
                setSlots(new Set(existing.slots))
              }}
            >
              Load their reply instead
            </button>
          </div>
        )}

        <div className="paint-toolbar">
          <span className="paint-hint">
            Click or drag to paint the times you're free · {slots.size} slot{slots.size === 1 ? '' : 's'} marked
          </span>
          <div className="paint-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => paint(new Set(allSlots))}>
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

        <TimeGrid def={ev} mode="paint" value={slots} onChange={paint} />

        <div className="card-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={save} disabled={!canSave}>
            {existing ? 'Update my availability' : 'Save my availability'}
          </button>
          {!canSave && <span className="fineprint">Add your name to save.</span>}
        </div>
      </section>

      {savedCode && (
        <section className="glass card callout-ok-card" role="status">
          <h2 className="card-title">Saved ✓</h2>
          <p className="muted">
            Your availability is stored in this browser and already counts toward the results
            here. <strong>Filling this in on your own device?</strong> Send the organizer this
            response code so they can import it into their results:
          </p>
          <CopyField value={savedCode} label="Response code" />
          <div className="card-actions">
            <Link to={`/event/${ev.id}`} className="btn btn-mint">
              See the group heatmap
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
