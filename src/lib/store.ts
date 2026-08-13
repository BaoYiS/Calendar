import { useSyncExternalStore } from 'react'
import type { EventDef, ResponseEntry, StoredEvent } from '../types'

const KEY = 'aquaplan.events.v1'

type EventMap = Record<string, StoredEvent>

let cache: EventMap | null = null
const listeners = new Set<() => void>()

function read(): EventMap {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? (JSON.parse(raw) as EventMap) : {}
  } catch {
    cache = {}
  }
  // Null prototype: route params like 'constructor' must never resolve to
  // inherited Object members when used as map keys.
  Object.setPrototypeOf(cache, null)
  return cache
}

function write(next: EventMap): void {
  Object.setPrototypeOf(next, null)
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage full or unavailable — keep the in-memory copy so the session still works.
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Keep tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    cache = null
    listeners.forEach((fn) => fn())
  }
})

export function useEvents(): EventMap {
  return useSyncExternalStore(subscribe, read)
}

export function getEvent(id: string): StoredEvent | undefined {
  return read()[id]
}

export function saveEvent(ev: StoredEvent): void {
  write({ ...read(), [ev.id]: ev })
}

export function deleteEvent(id: string): void {
  const next = { ...read() }
  delete next[id]
  write(next)
}

/** Store an event definition arriving from a share link. Never clobbers local responses. */
export function importEventDef(def: EventDef): StoredEvent {
  const existing = read()[def.id]
  if (existing) return existing
  const stored: StoredEvent = { ...def, responses: [], role: 'participant' }
  saveEvent(stored)
  return stored
}

export function upsertResponse(
  eventId: string,
  name: string,
  slots: string[],
): ResponseEntry | undefined {
  const ev = read()[eventId]
  if (!ev) return undefined
  const normalized = name.trim()
  const idKey = normalized.toLowerCase()
  const existing = ev.responses.find((r) => r.id === idKey)
  const entry: ResponseEntry = {
    id: idKey,
    name: normalized,
    slots: [...slots].sort(),
    updatedAt: Date.now(),
  }
  const responses = existing
    ? ev.responses.map((r) => (r.id === idKey ? entry : r))
    : [...ev.responses, entry]
  saveEvent({ ...ev, responses })
  return entry
}

export function removeResponse(eventId: string, responseId: string): void {
  const ev = read()[eventId]
  if (!ev) return
  saveEvent({ ...ev, responses: ev.responses.filter((r) => r.id !== responseId) })
}
