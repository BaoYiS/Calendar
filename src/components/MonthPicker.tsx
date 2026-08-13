import { useMemo, useRef, useState } from 'react'
import { dateLabel, fromDateISO, monthTitle, toDateISO } from '../lib/time'

interface MonthPickerProps {
  selected: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}

interface DayDrag {
  anchor: string
  current: string
  adding: boolean
}

/** See TimeGrid: hold to paint, move to scroll the page, quick lift to toggle. */
interface PendingTouch {
  pointerId: number
  startX: number
  startY: number
  lastY: number
  date: string
  mode: 'undecided' | 'scroll'
  timer: number
}

const TOUCH_HOLD_MS = 250
const TOUCH_SLOP_PX = 10

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function isoRange(a: string, b: string): string[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  const out: string[] = []
  const d = fromDateISO(lo)
  const end = fromDateISO(hi)
  while (d.getTime() <= end.getTime()) {
    out.push(toDateISO(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

export default function MonthPicker({ selected, onChange }: MonthPickerProps) {
  const today = toDateISO(new Date())
  const now = new Date()
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [drag, setDrag] = useState<DayDrag | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingTouch = useRef<PendingTouch | null>(null)

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1)
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
    const lead = first.getDay()
    const total = Math.ceil((lead + daysInMonth) / 7) * 7
    const list: (string | null)[] = []
    for (let i = 0; i < total; i++) {
      const day = i - lead + 1
      list.push(day >= 1 && day <= daysInMonth ? toDateISO(new Date(view.y, view.m, day)) : null)
    }
    return list
  }, [view])

  const displayed = useMemo(() => {
    if (!drag) return selected
    const next = new Set(selected)
    for (const iso of isoRange(drag.anchor, drag.current)) {
      if (iso < today) continue
      if (drag.adding) next.add(iso)
      else next.delete(iso)
    }
    return next
  }, [drag, selected, today])

  function dayAt(clientX: number, clientY: number): string | null {
    const el = document.elementFromPoint(clientX, clientY)
    const day = el?.closest<HTMLElement>('[data-date]')
    if (!day || !rootRef.current?.contains(day) || day.hasAttribute('disabled')) return null
    return day.dataset.date ?? null
  }

  function toggleDay(iso: string) {
    const next = new Set(selected)
    if (next.has(iso)) next.delete(iso)
    else next.add(iso)
    onChange(next)
  }

  function clearPendingTouch() {
    if (pendingTouch.current) {
      window.clearTimeout(pendingTouch.current.timer)
      pendingTouch.current = null
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const iso = dayAt(e.clientX, e.clientY)
    if (!iso) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.pointerType === 'touch') {
      const p: PendingTouch = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastY: e.clientY,
        date: iso,
        mode: 'undecided',
        timer: 0,
      }
      p.timer = window.setTimeout(() => {
        if (pendingTouch.current === p && p.mode === 'undecided') {
          pendingTouch.current = null
          setDrag({ anchor: p.date, current: p.date, adding: !selected.has(p.date) })
        }
      }, TOUCH_HOLD_MS)
      pendingTouch.current = p
      return
    }
    setDrag({ anchor: iso, current: iso, adding: !selected.has(iso) })
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pendingTouch.current
    if (p && e.pointerId === p.pointerId) {
      const dy = e.clientY - p.lastY
      if (
        p.mode === 'undecided' &&
        Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > TOUCH_SLOP_PX
      ) {
        window.clearTimeout(p.timer)
        p.mode = 'scroll'
      }
      if (p.mode === 'scroll') window.scrollBy(0, -dy)
      p.lastY = e.clientY
      return
    }
    if (!drag) return
    const iso = dayAt(e.clientX, e.clientY)
    if (iso && iso !== drag.current) setDrag({ ...drag, current: iso })
  }

  function commitDrag(e: React.PointerEvent<HTMLDivElement>) {
    const p = pendingTouch.current
    if (p && e.pointerId === p.pointerId) {
      clearPendingTouch()
      if (p.mode === 'undecided' && p.date >= today) toggleDay(p.date)
      return
    }
    if (drag) onChange(new Set(displayed))
    setDrag(null)
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    // Pointer interactions commit via drag; only keyboard activation (detail 0)
    // should toggle here, or the post-drag click would double-toggle.
    if (e.detail !== 0) return
    const day = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')
    if (!day || !day.dataset.date) return
    toggleDay(day.dataset.date)
  }

  const canGoBack = view.y > now.getFullYear() || (view.y === now.getFullYear() && view.m > now.getMonth())

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  return (
    <div className="monthpicker" ref={rootRef}>
      <div className="mp-head">
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => shiftMonth(-1)}
          disabled={!canGoBack}
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="mp-title" aria-live="polite">
          {monthTitle(view.y, view.m)}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="mp-dow" aria-hidden="true">
        {DOW.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div
        className="mp-grid"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={commitDrag}
        onPointerCancel={() => {
          clearPendingTouch()
          setDrag(null)
        }}
        onClick={onClick}
      >
        {cells.map((iso, i) => {
          if (!iso) return <span key={i} className="mp-blank" />
          const day = fromDateISO(iso).getDate()
          const isPast = iso < today
          const on = displayed.has(iso)
          return (
            <button
              key={iso}
              type="button"
              data-date={iso}
              disabled={isPast}
              aria-pressed={on}
              aria-label={dateLabel(iso).full}
              className={`mp-day${on ? ' mp-on' : ''}${iso === today ? ' mp-today' : ''}`}
            >
              {day}
            </button>
          )
        })}
      </div>
      <div className="mp-foot">
        <span className="mp-count">
          {selected.size === 0
            ? 'Click or drag to pick days'
            : `${selected.size} day${selected.size === 1 ? '' : 's'} selected`}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-disabled={selected.size === 0}
          onClick={() => {
            if (selected.size > 0) onChange(new Set())
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}
