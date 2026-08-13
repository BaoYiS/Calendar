import type { EventDef } from '../types'

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 'YYYY-MM-DD' for a local Date. */
export function toDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Parse 'YYYY-MM-DD' as a local Date (no timezone shifting). */
export function fromDateISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function slotKey(dateISO: string, minutes: number): string {
  return `${dateISO}T${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
}

export function parseSlotKey(key: string): { date: string; minutes: number } {
  const [date, hm] = key.split('T')
  const [h, m] = hm.split(':').map(Number)
  return { date, minutes: h * 60 + m }
}

/** Row offsets (minutes from midnight) for one day of the event. */
export function slotRows(def: Pick<EventDef, 'startMinutes' | 'endMinutes' | 'slotMinutes'>): number[] {
  const rows: number[] = []
  for (let m = def.startMinutes; m + def.slotMinutes <= def.endMinutes; m += def.slotMinutes) {
    rows.push(m)
  }
  return rows
}

/** '9:00 AM', '12:30 PM'; 1440 renders as '12 AM' (midnight). */
export function timeLabel(minutes: number, opts: { compact?: boolean } = {}): string {
  const total = ((minutes % 1440) + 1440) % 1440
  const h24 = Math.floor(total / 60)
  const m = total % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  if (opts.compact && m === 0) return `${h12} ${ampm}`
  return `${h12}:${pad2(m)} ${ampm}`
}

export function timeRangeLabel(startMin: number, endMin: number): string {
  return `${timeLabel(startMin)} – ${timeLabel(endMin)}`
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dateLabel(iso: string): { dow: string; md: string; full: string } {
  const d = fromDateISO(iso)
  const dow = DOW[d.getDay()]
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return { dow, md, full: `${dow}, ${md} ${d.getFullYear()}` }
}

export function monthTitle(year: number, month: number): string {
  const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December']
  return `${LONG[month]} ${year}`
}

/** Short human summary of the selected days, e.g. 'Aug 18 – Aug 22 (4 days)'. */
export function datesSummary(dates: string[]): string {
  if (dates.length === 0) return 'no days'
  const first = dateLabel(dates[0]).md
  if (dates.length === 1) return `${dateLabel(dates[0]).dow}, ${first}`
  const last = dateLabel(dates[dates.length - 1]).md
  return `${first} – ${last} (${dates.length} days)`
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  } catch {
    return 'UTC'
  }
}
