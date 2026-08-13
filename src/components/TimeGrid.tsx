import { useMemo, useRef, useState } from 'react'
import type { EventDef, ResponseEntry } from '../types'
import { dateLabel, parseSlotKey, slotKey, slotRows, timeLabel } from '../lib/time'
import { heatColor, heatInk } from '../lib/heat'

type Cell = [row: number, col: number]

interface DragState {
  anchor: Cell
  current: Cell
  adding: boolean
}

interface TimeGridProps {
  def: EventDef
  mode: 'paint' | 'heat'
  /** Paint mode: the current selection. */
  value?: ReadonlySet<string>
  onChange?: (next: Set<string>) => void
  /** Heat mode: everyone's answers. */
  responses?: ResponseEntry[]
  maxHeight?: number
}

interface TipState {
  x: number
  y: number
  slot: string
}

/**
 * A touch that hasn't committed to painting yet. A hold of TOUCH_HOLD_MS
 * starts a paint drag; moving first turns the gesture into a manual scroll
 * (cells carry touch-action:none, so the browser won't pan for us); a quick
 * lift is a tap-toggle.
 */
interface PendingTouch {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  cell: Cell
  mode: 'undecided' | 'scroll'
  timer: number
}

const TOUCH_HOLD_MS = 250
const TOUCH_SLOP_PX = 10

export default function TimeGrid({
  def,
  mode,
  value,
  onChange,
  responses = [],
  maxHeight = 520,
}: TimeGridProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingTouch = useRef<PendingTouch | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  const [focused, setFocused] = useState<Cell>([0, 0])

  const rows = useMemo(() => slotRows(def), [def])
  const dates = def.dates
  const total = responses.length

  const availability = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const r of responses) {
      for (const s of r.slots) {
        const arr = map.get(s)
        if (arr) arr.push(r.name)
        else map.set(s, [r.name])
      }
    }
    return map
  }, [responses])

  /** Selection with the in-flight drag rectangle applied as a live preview. */
  const displayed = useMemo(() => {
    if (mode !== 'paint' || !value) return null
    if (!drag) return value
    const next = new Set(value)
    const [r1, c1] = drag.anchor
    const [r2, c2] = drag.current
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        const k = slotKey(dates[c], rows[r])
        if (drag.adding) next.add(k)
        else next.delete(k)
      }
    }
    return next
  }, [mode, value, drag, dates, rows])

  function cellAt(clientX: number, clientY: number): Cell | null {
    const el = document.elementFromPoint(clientX, clientY)
    const cell = el?.closest<HTMLElement>('[data-cell]')
    if (!cell || !rootRef.current?.contains(cell)) return null
    return [Number(cell.dataset.r), Number(cell.dataset.c)]
  }

  function startPaint(cell: Cell) {
    if (!value) return
    const k = slotKey(dates[cell[1]], rows[cell[0]])
    setFocused(cell)
    setDrag({ anchor: cell, current: cell, adding: !value.has(k) })
  }

  function toggleCell(cell: Cell) {
    if (!value || !onChange) return
    const k = slotKey(dates[cell[1]], rows[cell[0]])
    const next = new Set(value)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setFocused(cell)
    onChange(next)
  }

  function clearPendingTouch() {
    if (pendingTouch.current) {
      window.clearTimeout(pendingTouch.current.timer)
      pendingTouch.current = null
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (mode !== 'paint' || !value || (e.pointerType === 'mouse' && e.button !== 0)) return
    const cell = cellAt(e.clientX, e.clientY)
    if (!cell) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.pointerType === 'touch') {
      const p: PendingTouch = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        cell,
        mode: 'undecided',
        timer: 0,
      }
      p.timer = window.setTimeout(() => {
        if (pendingTouch.current === p && p.mode === 'undecided') {
          pendingTouch.current = null
          startPaint(p.cell)
        }
      }, TOUCH_HOLD_MS)
      pendingTouch.current = p
      return
    }
    e.preventDefault()
    startPaint(cell)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (mode === 'heat') {
      const cell = cellAt(e.clientX, e.clientY)
      if (cell) setTip({ x: e.clientX, y: e.clientY, slot: slotKey(dates[cell[1]], rows[cell[0]]) })
      else setTip(null)
      return
    }
    const p = pendingTouch.current
    if (p && e.pointerId === p.pointerId) {
      const dx = e.clientX - p.lastX
      const dy = e.clientY - p.lastY
      if (
        p.mode === 'undecided' &&
        Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > TOUCH_SLOP_PX
      ) {
        window.clearTimeout(p.timer)
        p.mode = 'scroll'
      }
      if (p.mode === 'scroll') {
        const sc = scrollRef.current
        if (sc) {
          const beforeTop = sc.scrollTop
          sc.scrollTop -= dy
          sc.scrollLeft -= dx
          const leftoverY = dy - (beforeTop - sc.scrollTop)
          if (leftoverY !== 0) window.scrollBy(0, -leftoverY)
        }
      }
      p.lastX = e.clientX
      p.lastY = e.clientY
      return
    }
    if (!drag) return
    const cell = cellAt(e.clientX, e.clientY)
    if (cell && (cell[0] !== drag.current[0] || cell[1] !== drag.current[1])) {
      setDrag({ ...drag, current: cell })
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const p = pendingTouch.current
    if (p && e.pointerId === p.pointerId) {
      clearPendingTouch()
      if (p.mode === 'undecided') toggleCell(p.cell)
      return
    }
    if (drag && displayed && onChange) onChange(new Set(displayed))
    setDrag(null)
  }

  function onPointerCancel() {
    clearPendingTouch()
    setDrag(null)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
    if (!el) return
    const r = Number(el.dataset.r)
    const c = Number(el.dataset.c)
    if ((e.key === ' ' || e.key === 'Enter') && mode === 'paint' && value && onChange) {
      e.preventDefault()
      const k = slotKey(dates[c], rows[r])
      const next = new Set(value)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      onChange(next)
      return
    }
    let nr = r
    let nc = c
    if (e.key === 'ArrowUp') nr = r - 1
    else if (e.key === 'ArrowDown') nr = r + 1
    else if (e.key === 'ArrowLeft') nc = c - 1
    else if (e.key === 'ArrowRight') nc = c + 1
    else return
    e.preventDefault()
    nr = Math.max(0, Math.min(rows.length - 1, nr))
    nc = Math.max(0, Math.min(dates.length - 1, nc))
    setFocused([nr, nc])
    rootRef.current?.querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`)?.focus()
  }

  function onFocus(e: React.FocusEvent<HTMLDivElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
    if (!el) return
    setFocused([Number(el.dataset.r), Number(el.dataset.c)])
    if (mode === 'heat' && el.dataset.slot) {
      const rect = el.getBoundingClientRect()
      setTip({ x: rect.left + rect.width / 2, y: rect.bottom, slot: el.dataset.slot })
    }
  }

  return (
    <div className="tg" ref={rootRef}>
      <div
        ref={scrollRef}
        className={`tg-scroll ${mode === 'paint' ? 'tg-paintmode' : 'tg-heatmode'}`}
        style={{ maxHeight }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => setTip(null)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={() => setTip(null)}
      >
        <div
          className="tg-grid"
          role="grid"
          aria-label={mode === 'paint' ? 'Pick your available times' : 'Group availability'}
          style={{ gridTemplateColumns: `56px repeat(${dates.length}, minmax(76px, 1fr))` }}
        >
          <div role="row" style={{ display: 'contents' }}>
            <div className="tg-corner" role="columnheader" aria-label="Time" />
            {dates.map((d) => {
              const l = dateLabel(d)
              return (
                <div key={d} className="tg-dayhead" role="columnheader">
                  <span className="tg-dow">{l.dow}</span>
                  <span className="tg-md">{l.md}</span>
                </div>
              )
            })}
          </div>
          {rows.map((min, r) => {
            // Label the first row and every hour after it, so windows starting
            // off the hour (e.g. 9:30 with 60-min slots) still get a time column.
            const labeled = (min - def.startMinutes) % 60 === 0
            return (
            <div key={min} role="row" style={{ display: 'contents' }}>
              <div className={`tg-time${labeled ? ' tg-hourline' : ''}`} role="rowheader">
                {labeled ? timeLabel(min, { compact: true }) : ''}
              </div>
              {dates.map((d, c) => {
                const k = slotKey(d, min)
                const l = dateLabel(d)
                const slotLabel = `${l.dow} ${l.md}, ${timeLabel(min)} – ${timeLabel(min + def.slotMinutes)}`
                const isFocused = focused[0] === r && focused[1] === c
                if (mode === 'paint') {
                  const on = displayed?.has(k) ?? false
                  return (
                    <div
                      key={k}
                      role="gridcell"
                      aria-selected={on}
                      aria-label={`${slotLabel} — ${on ? 'available' : 'not marked'}`}
                      tabIndex={isFocused ? 0 : -1}
                      data-cell
                      data-r={r}
                      data-c={c}
                      data-slot={k}
                      className={`tg-cell${labeled ? ' tg-hourline' : ''}${on ? ' tg-on' : ''}`}
                    />
                  )
                }
                const names = availability.get(k) ?? []
                const t = total > 0 ? names.length / total : 0
                return (
                  <div
                    key={k}
                    role="gridcell"
                    aria-label={`${slotLabel} — ${names.length} of ${total} available`}
                    tabIndex={isFocused ? 0 : -1}
                    data-cell
                    data-r={r}
                    data-c={c}
                    data-slot={k}
                    className={`tg-cell tg-heatcell${labeled ? ' tg-hourline' : ''}`}
                    style={
                      names.length > 0
                        ? { background: heatColor(t), color: heatInk(t) }
                        : undefined
                    }
                  >
                    {names.length > 0 ? names.length : ''}
                  </div>
                )
              })}
            </div>
            )
          })}
        </div>
      </div>
      {tip && mode === 'heat' && (
        <HeatTip tip={tip} def={def} availability={availability} responses={responses} />
      )}
    </div>
  )
}

function HeatTip({
  tip,
  def,
  availability,
  responses,
}: {
  tip: TipState
  def: EventDef
  availability: Map<string, string[]>
  responses: ResponseEntry[]
}) {
  const { date, minutes } = parseSlotKey(tip.slot)
  const names = availability.get(tip.slot) ?? []
  const nameSet = new Set(names)
  const missing = responses.map((r) => r.name).filter((n) => !nameSet.has(n))
  const l = dateLabel(date)

  const width = 240
  const left = Math.max(8, Math.min(tip.x + 14, window.innerWidth - width - 8))
  const flip = tip.y > window.innerHeight - 220
  const top = flip ? tip.y - 14 : tip.y + 16

  return (
    <div
      className="heattip"
      role="status"
      style={{ left, top, width, transform: flip ? 'translateY(-100%)' : undefined }}
    >
      <div className="heattip-count">
        {names.length} of {responses.length} free
      </div>
      <div className="heattip-when">
        {l.dow} {l.md} · {timeLabel(minutes)} – {timeLabel(minutes + def.slotMinutes)}
      </div>
      {names.length > 0 && (
        <div className="heattip-names">
          <span className="heattip-dot heattip-dot-free" aria-hidden="true" />
          {names.join(', ')}
        </div>
      )}
      {missing.length > 0 && (
        <div className="heattip-names heattip-busy">
          <span className="heattip-dot heattip-dot-busy" aria-hidden="true" />
          {missing.join(', ')}
        </div>
      )}
    </div>
  )
}
