import { useMemo } from 'react'
import { listTimezones } from '../lib/tz'

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

export function zoneLabel(z: string): string {
  const slash = z.indexOf('/')
  return (slash === -1 ? z : z.slice(slash + 1)).replace(/_/g, ' ').replace(/\//g, ' – ')
}

interface TimezoneSelectProps {
  id?: string
  value: string
  onChange: (tz: string) => void
}

/** Region-grouped IANA timezone select. */
export default function TimezoneSelect({ id, value, onChange }: TimezoneSelectProps) {
  const groups = useMemo(() => groupZones(listTimezones()), [])

  return (
    <select
      id={id}
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
  )
}
