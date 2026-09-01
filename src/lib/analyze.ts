import type { EventDef, ResponseEntry } from '../types'
import { parseSlotKey, slotKey, slotRows } from './time'

export interface BestRange {
  date: string
  startMin: number
  endMin: number
  count: number
  names: string[]
}

/**
 * Rank the best meeting windows: consecutive slots on the same day with the
 * exact same group of available people merge into one range. Sorted by
 * headcount, then duration, then chronology.
 */
export function bestTimes(def: EventDef, responses: ResponseEntry[], limit = 5): BestRange[] {
  if (responses.length === 0) return []
  const rows = slotRows(def)
  const bySlot = new Map<string, string[]>()
  for (const r of responses) {
    for (const s of r.slots) {
      const arr = bySlot.get(s)
      if (arr) arr.push(r.name)
      else bySlot.set(s, [r.name])
    }
  }

  const ranges: BestRange[] = []
  for (const date of def.dates) {
    let open: BestRange | null = null
    for (const min of rows) {
      const names = [...(bySlot.get(slotKey(date, min)) ?? [])].sort()
      const sameGroup =
        open !== null &&
        open.names.length === names.length &&
        open.names.every((n, i) => n === names[i])
      if (open && open.endMin === min && sameGroup) {
        open.endMin = min + def.slotMinutes
      } else {
        if (open && open.count > 0) ranges.push(open)
        open = names.length > 0
          ? { date, startMin: min, endMin: min + def.slotMinutes, count: names.length, names }
          : null
      }
    }
    if (open && open.count > 0) ranges.push(open)
  }

  ranges.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    const durA = a.endMin - a.startMin
    const durB = b.endMin - b.startMin
    if (durB !== durA) return durB - durA
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return a.startMin - b.startMin
  })
  return ranges.slice(0, limit)
}

export interface TimeRange {
  date: string
  startMin: number
  endMin: number
}

export interface PersonSchedule {
  id: string
  name: string
  ranges: TimeRange[]
}

/**
 * Each person's chosen slots merged into per-day ranges, in reply order (the
 * same order the claims grid uses for colours). For the exclusive and
 * schedule-planning views.
 */
export function personSchedules(def: EventDef, responses: ResponseEntry[]): PersonSchedule[] {
  return responses.map((r) => {
    const minutes = new Map<string, number[]>()
    for (const s of r.slots) {
      const { date, minutes: m } = parseSlotKey(s)
      const arr = minutes.get(date)
      if (arr) arr.push(m)
      else minutes.set(date, [m])
    }
    const ranges: TimeRange[] = []
    for (const date of def.dates) {
      const mins = minutes.get(date)
      if (!mins) continue
      mins.sort((a, b) => a - b)
      let open: TimeRange | null = null
      for (const m of mins) {
        if (open && open.endMin === m) {
          open.endMin = m + def.slotMinutes
        } else {
          if (open) ranges.push(open)
          open = { date, startMin: m, endMin: m + def.slotMinutes }
        }
      }
      if (open) ranges.push(open)
    }
    return { id: r.id, name: r.name, ranges }
  })
}

/**
 * Slots picked by two or more people, as slotKey → names. Empty for a
 * well-behaved exclusive event; non-empty after e.g. importing clashing
 * response codes, so the organizer can spot and resolve the clash.
 */
export function conflictSlots(responses: ResponseEntry[]): Map<string, string[]> {
  const bySlot = new Map<string, string[]>()
  for (const r of responses) {
    for (const s of r.slots) {
      const arr = bySlot.get(s)
      if (arr) arr.push(r.name)
      else bySlot.set(s, [r.name])
    }
  }
  for (const [k, names] of bySlot) if (names.length < 2) bySlot.delete(k)
  return bySlot
}
