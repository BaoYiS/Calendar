import type { EventDef, EventMode, ResponseEntry } from '../types'

export interface ApiUser {
  id: string
  username: string
  /** IANA zone captured when the account was created (or on the first sign-in
   *  after the feature shipped); null until then. */
  defaultTimezone: string | null
}

/** A server-stored event, as returned by the API. */
export interface RemoteEvent extends EventDef {
  ownerName: string
  mine: boolean
  responses: ResponseEntry[]
}

export interface RemoteEventSummary {
  id: string
  name: string
  mode: EventMode
  dates: string[]
  startMinutes: number
  endMinutes: number
  slotMinutes: number
  timezone: string
  createdAt: number
  mine: boolean
  replyCount: number
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server.')
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // Non-JSON error body — fall through to the status check.
  }
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status}).`
    throw new ApiError(res.status, message)
  }
  return data as T
}

export interface NewEventInput {
  name: string
  description?: string
  mode: EventMode
  dates: string[]
  startMinutes: number
  endMinutes: number
  slotMinutes: number
  timezone: string
  /** Optional replies to import (used when moving a browser event to an account). */
  responses?: { name: string; slots: string[] }[]
  /** Old browser-local event id, kept as a server alias so old links still work. */
  movedFrom?: string
}

export const api = {
  me: () => request<{ user: ApiUser | null }>('GET', '/api/auth/me'),
  register: (username: string, password: string, timezone: string) =>
    request<{ user: ApiUser }>('POST', '/api/auth/register', { username, password, timezone }),
  login: (username: string, password: string, timezone: string) =>
    request<{ user: ApiUser }>('POST', '/api/auth/login', { username, password, timezone }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  updateSettings: (settings: { defaultTimezone: string }) =>
    request<{ user: ApiUser }>('PATCH', '/api/auth/me', settings),

  listEvents: () => request<{ events: RemoteEventSummary[] }>('GET', '/api/events'),
  createEvent: (input: NewEventInput) =>
    request<{ event: RemoteEvent }>('POST', '/api/events', input),
  getEvent: (id: string) =>
    request<{ event: RemoteEvent }>('GET', `/api/events/${encodeURIComponent(id)}`),
  deleteEvent: (id: string) =>
    request<{ ok: true }>('DELETE', `/api/events/${encodeURIComponent(id)}`),
  respond: (id: string, name: string, slots: string[], asUser?: string) =>
    request<{ event: RemoteEvent; responseId: string }>(
      'PUT',
      `/api/events/${encodeURIComponent(id)}/responses`,
      // asUser makes the server refuse (401) instead of silently saving a
      // guest reply when the session expired under a still-signed-in-looking UI.
      { name, slots, ...(asUser !== undefined ? { asUser } : {}) },
    ),
  removeResponse: (id: string, responseId: string) =>
    request<{ event: RemoteEvent }>(
      'DELETE',
      `/api/events/${encodeURIComponent(id)}/responses/${encodeURIComponent(responseId)}`,
    ),
}
