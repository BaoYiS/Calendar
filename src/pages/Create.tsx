import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import MonthPicker from '../components/MonthPicker'
import TimezoneSelect from '../components/TimezoneSelect'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { saveEvent } from '../lib/store'
import { localTimezone, timeLabel } from '../lib/time'
import { isValidTimezone, offsetBadge, relationToEvent } from '../lib/tz'
import type { SlotMinutes, StoredEvent } from '../types'

const HALF_HOURS = Array.from({ length: 49 }, (_, i) => i * 30)

function randomId(): string {
  // crypto.randomUUID is secure-context-only; getRandomValues works everywhere
  // (e.g. the built app served over plain http on a LAN).
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

export default function Create() {
  const navigate = useNavigate()
  const { status, user } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dates, setDates] = useState<Set<string>>(new Set())
  const [startMinutes, setStartMinutes] = useState(9 * 60)
  const [endMinutes, setEndMinutes] = useState(17 * 60)
  const [slotMinutes, setSlotMinutes] = useState<SlotMinutes>(30)
  // null = follow homeTz (which can change when auth settles); a string is an
  // explicit choice for this event and sticks.
  const [chosenTz, setChosenTz] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverErr, setServerErr] = useState<string | null>(null)

  // The signed-in user's stored default beats the device zone; guests (and
  // accounts with no stored default yet) fall back to the device zone.
  const accountTz =
    user?.defaultTimezone && isValidTimezone(user.defaultTimezone) ? user.defaultTimezone : null
  const homeTz = accountTz ?? localTimezone()
  const timezone = chosenTz ?? homeTz

  const problems: string[] = []
  if (name.trim() === '') problems.push('Give the event a name.')
  if (dates.size === 0) problems.push('Pick at least one day.')
  if (dates.size > 100) problems.push('Pick at most 100 days.')
  if (startMinutes >= endMinutes) problems.push('The end time must be after the start time.')
  else if (endMinutes - startMinutes < slotMinutes)
    problems.push(`That window is shorter than one ${slotMinutes}-minute slot.`)

  // The advertised window should match what the grid can actually offer.
  const windowLen = endMinutes - startMinutes
  const lastSlotEnd =
    windowLen >= slotMinutes
      ? startMinutes + Math.floor(windowLen / slotMinutes) * slotMinutes
      : null
  const unevenNote =
    lastSlotEnd !== null && lastSlotEnd !== endMinutes
      ? `Heads up: ${slotMinutes}-minute slots don't fill the window evenly — the last slot will end at ${timeLabel(lastSlotEnd)}.`
      : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    // Wait for auth to settle: submitting while /me is in flight would silently
    // downgrade a signed-in user's event to browser-local.
    if (problems.length > 0 || busy || status === 'loading') return

    // Primary path: signed in — the event lives on the server, so the invite
    // link works from any device.
    if (user) {
      setBusy(true)
      setServerErr(null)
      try {
        const { event } = await api.createEvent({
          name: name.trim(),
          description: description.trim() || undefined,
          dates: [...dates].sort(),
          startMinutes,
          endMinutes,
          slotMinutes,
          timezone,
        })
        navigate(`/event/${event.id}`)
      } catch (err) {
        setServerErr(
          err instanceof ApiError ? err.message : 'Could not reach the server — try again.',
        )
      } finally {
        setBusy(false)
      }
      return
    }

    // Guest fallback: browser-local storage.
    const ev: StoredEvent = {
      id: randomId(),
      name: name.trim(),
      description: description.trim() || undefined,
      dates: [...dates].sort(),
      startMinutes,
      endMinutes,
      slotMinutes,
      timezone,
      createdAt: Date.now(),
      responses: [],
      role: 'organizer',
    }
    saveEvent(ev)
    navigate(`/event/${ev.id}`)
  }

  return (
    <div className="page">
      <form className="glass card" onSubmit={submit}>
        <h1 className="card-title">New event</h1>

        {status === 'ready' && !user && (
          <div className="callout callout-warn">
            You're not signed in, so this event will live only in this browser and invitees will
            send replies back as copy-paste codes.{' '}
            <Link to="/login?next=/create">Sign in</Link> to put it on the server instead — one
            link, replies from anywhere.
          </div>
        )}

        <label className="field">
          <span className="field-label">Event name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team retro, board-game night, project kickoff…"
            maxLength={80}
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field-label">
            Description <em className="field-opt">(optional)</em>
          </span>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything invitees should know"
            maxLength={200}
          />
        </label>

        <div className="field">
          <span className="field-label">Which days could work?</span>
          <MonthPicker selected={dates} onChange={setDates} />
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">No earlier than</span>
            <select
              className="input"
              value={startMinutes}
              onChange={(e) => setStartMinutes(Number(e.target.value))}
            >
              {HALF_HOURS.filter((m) => m < 24 * 60).map((m) => (
                <option key={m} value={m}>
                  {timeLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">No later than</span>
            <select
              className="input"
              value={endMinutes}
              onChange={(e) => setEndMinutes(Number(e.target.value))}
            >
              {HALF_HOURS.filter((m) => m > 0).map((m) => (
                <option key={m} value={m}>
                  {m === 24 * 60 ? '12:00 AM (midnight)' : timeLabel(m)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="create-tz">
            Timezone
          </label>
          <div className="tzpicker-row">
            <TimezoneSelect id="create-tz" value={timezone} onChange={setChosenTz} />
            <span className="badge badge-dim tzpicker-offset">{offsetBadge(timezone)}</span>
            {timezone !== homeTz && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setChosenTz(null)}
              >
                My timezone
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Slot size</span>
          <div className="segmented" role="group" aria-label="Slot size">
            {([15, 30, 60] as SlotMinutes[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={slotMinutes === m}
                className={`seg${slotMinutes === m ? ' seg-on' : ''}`}
                onClick={() => setSlotMinutes(m)}
              >
                {m === 60 ? '1 hour' : `${m} min`}
              </button>
            ))}
          </div>
        </div>

        {unevenNote && <p className="fineprint">{unevenNote}</p>}
        <p className="fineprint">
          {timezone === homeTz
            ? `Times are in your ${accountTz ? 'default ' : ''}timezone: ${timezone}.`
            : `Times are in ${timezone} — your ${accountTz ? 'default ' : ''}timezone (${homeTz}) is ${relationToEvent(
                homeTz,
                timezone,
              )}.`}
          {user ? ` Saved to ${user.username}'s account.` : ''}
        </p>

        {touched && problems.length > 0 && (
          <div className="callout callout-warn" role="alert">
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        )}
        {serverErr && (
          <div className="callout callout-warn" role="alert">
            {serverErr}
          </div>
        )}

        <div className="card-actions">
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={busy || status === 'loading'}
          >
            {busy ? 'Creating…' : status === 'loading' ? 'One sec…' : 'Create event'}
          </button>
        </div>
      </form>
    </div>
  )
}
