import { localTimezone } from '../lib/time'
import { offsetBadge, relationToEvent } from '../lib/tz'
import TimezoneSelect, { zoneLabel } from './TimezoneSelect'

interface TimezonePickerProps {
  eventTz: string
  value: string
  onChange: (tz: string) => void
}

export default function TimezonePicker({ eventTz, value, onChange }: TimezonePickerProps) {
  const localTz = localTimezone()

  return (
    <div className="tzpicker">
      <div className="tzpicker-row">
        <label className="tzpicker-label" htmlFor="tzpicker-select">
          Times shown in
        </label>
        <TimezoneSelect id="tzpicker-select" value={value} onChange={onChange} />
        <span className="badge badge-dim tzpicker-offset">{offsetBadge(value)}</span>
        {value !== localTz && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(localTz)}>
            My time
          </button>
        )}
        {value !== eventTz && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(eventTz)}>
            Event time
          </button>
        )}
      </div>
      {value !== eventTz && (
        <p className="fineprint tzpicker-note">
          {zoneLabel(value)} is {relationToEvent(value, eventTz)} ({zoneLabel(eventTz)}). Day
          boundaries are marked +1 where times roll past midnight.
        </p>
      )}
    </div>
  )
}
