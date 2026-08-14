import { useMemo } from 'react'
import { localTimezone } from '../lib/time'
import { listTimezones, offsetBadge, relationToEvent } from '../lib/tz'

interface TimezonePickerProps {
  eventTz: string
  value: string
  onChange: (tz: string) => void
}

/** Group IANA zones by region for a scannable optgroup select. */
function groupZones(zones: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const z of zones) {
    const slash = z.indexOf('/')
    const region = slash === -1 ? 'Other' : z.slice(0, slash)
    const arr = groups.get(region)
    if (arr) arr.push(z)
    else groups.set(region, [z])
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

function zoneLabel(z: string): string {
  const slash = z.indexOf('/')
  return (slash === -1 ? z : z.slice(slash + 1)).replace(/_/g, ' ').replace(/\//g, ' – ')
}

export default function TimezonePicker({ eventTz, value, onChange }: TimezonePickerProps) {
  const groups = useMemo(() => groupZones(listTimezones()), [])
  const localTz = localTimezone()

  return (
    <div className="tzpicker">
      <div className="tzpicker-row">
        <label className="tzpicker-label" htmlFor="tzpicker-select">
          Times shown in
        </label>
        <select
          id="tzpicker-select"
          className="input tzpicker-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {groups.map(([region, zones]) => (
            <optgroup key={region} label={region}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {zoneLabel(z)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
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
