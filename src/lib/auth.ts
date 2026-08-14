import { useSyncExternalStore } from 'react'
import { api, type ApiUser } from './api'

export interface AuthState {
  /** 'loading' until the first /me round-trip settles. */
  status: 'loading' | 'ready'
  user: ApiUser | null
}

let state: AuthState = { status: 'loading', user: null }
const listeners = new Set<() => void>()
let started = false

function setState(next: AuthState) {
  state = next
  listeners.forEach((fn) => fn())
}

function start() {
  if (started) return
  started = true
  api
    .me()
    .then(({ user }) => setState({ status: 'ready', user }))
    .catch(() => setState({ status: 'ready', user: null }))
}

/** Drop to signed-out locally (e.g. after a 401 revealed the session is dead). */
export function clearUser(): void {
  setState({ status: 'ready', user: null })
}

/** Re-ask the server who we are and sync the store. */
export async function refreshAuth(): Promise<void> {
  try {
    const { user } = await api.me()
    setState({ status: 'ready', user })
  } catch {
    // Server unreachable — keep current belief rather than guessing.
  }
}

// Sign-out in one tab signs out the others too.
const LOGOUT_KEY = 'aquaplan.logout'
window.addEventListener('storage', (e) => {
  if (e.key === LOGOUT_KEY) clearUser()
})

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useAuth(): AuthState {
  start()
  return useSyncExternalStore(subscribe, () => state)
}

export async function login(username: string, password: string): Promise<ApiUser> {
  const { user } = await api.login(username, password)
  setState({ status: 'ready', user })
  return user
}

export async function register(username: string, password: string): Promise<ApiUser> {
  const { user } = await api.register(username, password)
  setState({ status: 'ready', user })
  return user
}

/**
 * Returns false when the server couldn't be reached — the session cookie is
 * then still alive, so the UI must NOT pretend the user is signed out.
 */
export async function logout(): Promise<boolean> {
  try {
    await api.logout()
  } catch {
    return false
  }
  setState({ status: 'ready', user: null })
  try {
    localStorage.setItem(LOGOUT_KEY, String(Date.now()))
  } catch {
    // Cross-tab broadcast is best-effort.
  }
  return true
}
