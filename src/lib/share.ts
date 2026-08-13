import type { EventDef, SlotMinutes } from '../types'
import { slotKey, slotRows, parseSlotKey, fromDateISO, toDateISO } from './time'

function b64uEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64uDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(pad)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** Compact wire form of an event definition (no responses). */
interface EventWire {
  v: 1
  id: string
  n: string
  d?: string
  ds: string[]
  s: number
  e: number
  m: SlotMinutes
  tz: string
  c: number
}

export function encodeEventDef(def: EventDef): string {
  const wire: EventWire = {
    v: 1,
    id: def.id,
    n: def.name,
    ...(def.description ? { d: def.description } : {}),
    ds: def.dates,
    s: def.startMinutes,
    e: def.endMinutes,
    m: def.slotMinutes,
    tz: def.timezone,
    c: def.createdAt,
  }
  return b64uEncode(JSON.stringify(wire))
}

/**
 * Decode an event definition from a share link. The payload is untrusted —
 * every field is validated so a crafted link can't freeze the grid (huge
 * windows / date lists), crash React (non-string description), or smuggle an
 * id that breaks routing or object-key lookups.
 */
export function decodeEventDef(encoded: string): EventDef | null {
  try {
    const w = JSON.parse(b64uDecode(encoded)) as EventWire
    if (w.v !== 1) return null
    if (typeof w.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(w.id)) return null
    if (typeof w.n !== 'string' || w.n.trim() === '') return null
    if (!Array.isArray(w.ds) || w.ds.length === 0 || w.ds.length > 100) return null
    const validDate = (d: unknown): d is string =>
      typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && toDateISO(fromDateISO(d)) === d
    if (!w.ds.every(validDate)) return null
    if (![15, 30, 60].includes(w.m)) return null
    if (!Number.isInteger(w.s) || !Number.isInteger(w.e)) return null
    if (w.s < 0 || w.s >= w.e || w.e > 1440) return null
    return {
      id: w.id,
      name: w.n.trim().slice(0, 80),
      description: typeof w.d === 'string' ? w.d.slice(0, 200) : undefined,
      dates: [...new Set(w.ds)].sort(),
      startMinutes: w.s,
      endMinutes: w.e,
      slotMinutes: w.m,
      timezone: typeof w.tz === 'string' ? w.tz.slice(0, 64) : 'UTC',
      createdAt: typeof w.c === 'number' ? w.c : Date.now(),
    }
  } catch {
    return null
  }
}

/** Response codes reference slots as [dateIndex, rowIndex] against the event def. */
interface ResponseWire {
  v: 1
  id: string
  n: string
  s: [number, number][]
}

export function encodeResponse(eventDef: EventDef, name: string, slots: string[]): string {
  const rows = slotRows(eventDef)
  const rowIndex = new Map(rows.map((m, i) => [m, i]))
  const dateIndex = new Map(eventDef.dates.map((d, i) => [d, i]))
  const pairs: [number, number][] = []
  for (const key of slots) {
    const { date, minutes } = parseSlotKey(key)
    const di = dateIndex.get(date)
    const ri = rowIndex.get(minutes)
    if (di !== undefined && ri !== undefined) pairs.push([di, ri])
  }
  const wire: ResponseWire = { v: 1, id: eventDef.id, n: name, s: pairs }
  return b64uEncode(JSON.stringify(wire))
}

export function decodeResponse(
  eventDef: EventDef,
  encoded: string,
): { name: string; slots: string[] } | null {
  try {
    const w = JSON.parse(b64uDecode(encoded.trim())) as ResponseWire
    if (w.v !== 1 || typeof w.n !== 'string' || !Array.isArray(w.s)) return null
    if (w.id !== eventDef.id) return null
    const rows = slotRows(eventDef)
    const slots: string[] = []
    for (const pair of w.s) {
      if (!Array.isArray(pair) || pair.length !== 2) continue
      const [di, ri] = pair
      const date = eventDef.dates[di]
      const minutes = rows[ri]
      if (date !== undefined && minutes !== undefined) slots.push(slotKey(date, minutes))
    }
    return { name: w.n.trim(), slots }
  } catch {
    return null
  }
}

export function respondUrl(def: EventDef): string {
  const base = `${location.origin}${location.pathname}`
  return `${base}#/respond/${def.id}?d=${encodeEventDef(def)}`
}
