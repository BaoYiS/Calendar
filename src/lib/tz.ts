import { useState } from 'react'
import { fromDateISO, localTimezone, timeLabel, toDateISO } from './time'

const VIEW_TZ_KEY = 'aquaplan.viewtz.v1'

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(tz, f)
  }
  return f
}

export function isValidTimezone(tz: string): boolean {
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

/** Minutes east of UTC for `tz` at the given instant. */
export function tzOffsetMinutes(epoch: number, tz: string): number {
  const parts: Record<string, string> = {}
  for (const p of formatter(tz).formatToParts(new Date(epoch))) parts[p.type] = p.value
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return Math.round((asUTC - epoch) / 60000)
}

/** Epoch ms of wall-clock (dateISO, minutes-from-midnight) in `tz`. */
export function zonedToEpoch(dateISO: string, minutes: number, tz: string): number {
  const [y, m, d] = dateISO.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, minutes)
  // Two correction passes converge across DST boundaries.
  let epoch = guess
  for (let i = 0; i < 2; i++) epoch = guess - tzOffsetMinutes(epoch, tz) * 60000
  return epoch
}

/**
 * Display shift in minutes for one event day: what to add to an event-local
 * minute to get the viewer-local wall clock. Computed at the window start, so
 * a DST jump inside a single day's window is approximated by its start offset.
 */
export function columnShift(
  dateISO: string,
  startMinutes: number,
  eventTz: string,
  viewTz: string,
): number {
  if (eventTz === viewTz) return 0
  const epoch = zonedToEpoch(dateISO, startMinutes, eventTz)
  return tzOffsetMinutes(epoch, viewTz) - tzOffsetMinutes(epoch, eventTz)
}

/** '8:00 PM – 2:30 AM (+1)' — a window in shifted wall-clock minutes. */
export function shiftedRange(startMin: number, endMin: number): string {
  const crossed = Math.floor((endMin - 1) / 1440) > Math.floor(startMin / 1440)
  return `${timeLabel(startMin)} – ${timeLabel(endMin)}${crossed ? ' (+1)' : ''}`
}

export function addDays(dateISO: string, days: number): string {
  if (days === 0) return dateISO
  const d = fromDateISO(dateISO)
  d.setDate(d.getDate() + days)
  return toDateISO(d)
}

/** 'UTC+09:00' style badge for a zone right now. */
export function offsetBadge(tz: string): string {
  const off = tzOffsetMinutes(Date.now(), tz)
  const sign = off < 0 ? '-' : '+'
  const abs = Math.abs(off)
  const h = String(Math.floor(abs / 60)).padStart(2, '0')
  const m = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${h}:${m}`
}

/** Human relation between two zones right now, e.g. '3.5h ahead of event time'. */
export function relationToEvent(viewTz: string, eventTz: string): string {
  const now = Date.now()
  const diff = tzOffsetMinutes(now, viewTz) - tzOffsetMinutes(now, eventTz)
  if (diff === 0) return 'same as event time'
  const hours = Math.abs(diff) / 60
  const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, '')
  return `${rounded}h ${diff > 0 ? 'ahead of' : 'behind'} event time`
}

const FALLBACK_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Pacific/Honolulu',
]

export function listTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  try {
    const zones = intl.supportedValuesOf?.('timeZone')
    if (zones && zones.length > 0) return zones
  } catch {
    // Older engines: fall through to the curated list.
  }
  return FALLBACK_ZONES
}

/** The viewer's chosen display timezone, persisted across pages and visits. */
export function useViewTimezone(): [string, (tz: string) => void] {
  const [tz, setTz] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(VIEW_TZ_KEY)
      if (stored && isValidTimezone(stored)) return stored
    } catch {
      // Storage unavailable — just use the local zone.
    }
    return localTimezone()
  })
  const set = (next: string) => {
    if (!isValidTimezone(next)) return
    setTz(next)
    try {
      localStorage.setItem(VIEW_TZ_KEY, next)
    } catch {
      // Non-persistent is fine.
    }
  }
  return [tz, set]
}
