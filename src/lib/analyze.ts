import type { EventDef, ResponseEntry } from '../types'
import { slotKey, slotRows } from './time'

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
