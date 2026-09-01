export type SlotMinutes = 15 | 30 | 60

/**
 * What replies mean and how they combine:
 * - 'overlap':   find times when everyone is free (mutually available).
 * - 'exclusive': each slot belongs to at most one person (sign-ups, 1-on-1s).
 * - 'schedule':  everyone picks times; the organizer plans around the picks.
 */
export type EventMode = 'overlap' | 'exclusive' | 'schedule'

export interface EventDef {
  id: string
  name: string
  description?: string
  /** Missing on events from before modes existed — treat as 'overlap'. */
  mode?: EventMode
  /** Selected days as 'YYYY-MM-DD', kept sorted. */
  dates: string[]
  /** Daily window, minutes from midnight. start inclusive, end exclusive. */
  startMinutes: number
  endMinutes: number
  slotMinutes: SlotMinutes
  /** IANA timezone of the creator, e.g. 'Europe/London'. Times are wall-clock in this zone. */
  timezone: string
  createdAt: number
}

export interface ResponseEntry {
  /** Local events: lowercased name. Server events: an opaque per-reply id. */
  id: string
  name: string
  /** Slot keys 'YYYY-MM-DDTHH:MM' the person is available for. */
  slots: string[]
  updatedAt: number
  /** Server events only: whether the reply belongs to an account. */
  registered?: boolean
  /** Server events only: whether the reply belongs to the current viewer. */
  self?: boolean
}

export interface StoredEvent extends EventDef {
  responses: ResponseEntry[]
  /** Whether this browser created the event or joined via a link. */
  role: 'organizer' | 'participant'
}
