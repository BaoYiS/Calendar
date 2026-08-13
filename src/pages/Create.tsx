import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MonthPicker from '../components/MonthPicker'
import { saveEvent } from '../lib/store'
import { localTimezone, timeLabel } from '../lib/time'
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
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dates, setDates] = useState<Set<string>>(new Set())
  const [startMinutes, setStartMinutes] = useState(9 * 60)
  const [endMinutes, setEndMinutes] = useState(17 * 60)
  const [slotMinutes, setSlotMinutes] = useState<SlotMinutes>(30)
  const [touched, setTouched] = useState(false)

  const problems: string[] = []
  if (name.trim() === '') problems.push('Give the event a name.')
  if (dates.size === 0) problems.push('Pick at least one day.')
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

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (problems.length > 0) return
    const ev: StoredEvent = {
      id: randomId(),
      name: name.trim(),
      description: description.trim() || undefined,
      dates: [...dates].sort(),
      startMinutes,
      endMinutes,
      slotMinutes,
      timezone: localTimezone(),
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
        <p className="fineprint">Times are in your timezone: {localTimezone()}.</p>

        {touched && problems.length > 0 && (
          <div className="callout callout-warn" role="alert">
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        )}

        <div className="card-actions">
          <button type="submit" className="btn btn-primary btn-lg">
            Create event
          </button>
        </div>
      </form>
    </div>
  )
}
