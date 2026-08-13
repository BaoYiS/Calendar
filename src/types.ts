export type SlotMinutes = 15 | 30 | 60

export interface EventDef {
  id: string
  name: string
  description?: string
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
  id: string
  name: string
  /** Slot keys 'YYYY-MM-DDTHH:MM' the person is available for. */
  slots: string[]
  updatedAt: number
}

export interface StoredEvent extends EventDef {
  responses: ResponseEntry[]
  /** Whether this browser created the event or joined via a link. */
  role: 'organizer' | 'participant'
}
