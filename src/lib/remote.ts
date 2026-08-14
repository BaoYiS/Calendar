import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type RemoteEvent } from './api'

interface RemoteEventState {
  /** The server event, or null once we know the server doesn't have it. */
  remote: RemoteEvent | null
  /** True until the first fetch settles. */
  loading: boolean
  refresh: () => void
}

/**
 * Fetch a server event by id, with optional background polling (paused while
 * the tab is hidden, refreshed when it becomes visible again). A first-load
 * failure of any kind resolves to null so callers can fall back to
 * browser-local storage — but once an event has loaded, only an authoritative
 * 404 clears it. Transient failures (network blip, server restart, 5xx) keep
 * the last-known-good event instead of collapsing live pages to "not found".
 */
export function useRemoteEvent(id: string, pollMs = 0): RemoteEventState {
  const [remote, setRemote] = useState<RemoteEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const lastId = useRef(id)

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let alive = true
    if (lastId.current !== id) {
      // Route param changed — never show the previous event's data.
      lastId.current = id
      setRemote(null)
    }
    setLoading(true)
    const load = async () => {
      try {
        const { event } = await api.getEvent(id)
        if (alive) {
          setRemote(event)
          setLoading(false)
        }
      } catch (err) {
        if (alive) {
          if (err instanceof ApiError && err.status === 404) setRemote(null)
          setLoading(false)
        }
      }
    }
    load()
    const timer =
      pollMs > 0
        ? window.setInterval(() => {
            if (!document.hidden) load()
          }, pollMs)
        : undefined
    const onVisible = () => {
      if (!document.hidden && pollMs > 0) load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      if (timer !== undefined) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [id, pollMs, tick])

  return { remote, loading, refresh }
}
