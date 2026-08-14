/**
 * AquaPlan API — Express app factory shared by the Vite dev server (mounted as
 * middleware) and the production entry (server/index.mjs).
 *
 * Storage is a single JSON file with debounced atomic writes — plenty for a
 * self-hosted scheduling tool, and no native dependencies.
 *
 * Response identity: internally each reply is keyed 'u:<userId>' (accounts) or
 * 'g:<nameLower>' (guests) for upserts, but the API only ever exposes a random
 * opaque `rid` per reply, so share-link viewers can't harvest stable account
 * ids or correlate users across events.
 */
import express from 'express'
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

const SESSION_COOKIE = 'aqsession'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000
const MAX_USERS = 1000
const MAX_RESPONSES_PER_EVENT = 300
const MAX_IMPORT_RESPONSES = 200

// ---------------------------------------------------------------- persistence

const DATA_DIR =
  process.env.AQUAPLAN_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const DATA_FILE = path.join(DATA_DIR, 'aquaplan.json')

function emptyDb() {
  return { users: {}, sessions: {}, events: {}, aliases: {} }
}

function loadDb() {
  let parsed = null
  try {
    if (existsSync(DATA_FILE)) parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8'))
  } catch (err) {
    console.error('[aquaplan] could not read data file, starting empty:', err.message)
  }
  const loaded = {
    users: parsed?.users ?? {},
    sessions: parsed?.sessions ?? {},
    events: parsed?.events ?? {},
    aliases: parsed?.aliases ?? {},
  }
  // Migrate any pre-rid response records: move the old public `id` key to the
  // internal `key`, and give every reply an opaque rid.
  for (const ev of Object.values(loaded.events)) {
    for (const r of ev.responses ?? []) {
      if (r.key === undefined && typeof r.id === 'string') {
        r.key = r.id
        delete r.id
      }
      if (typeof r.rid !== 'string') r.rid = randomBytes(8).toString('hex')
    }
  }
  // Drop expired sessions eagerly — lazy per-token cleanup never removes
  // sessions whose cookies are never presented again.
  const now = Date.now()
  for (const [token, s] of Object.entries(loaded.sessions)) {
    if (!s || s.expiresAt <= now) delete loaded.sessions[token]
  }
  return loaded
}

const db = loadDb()
for (const table of Object.values(db)) Object.setPrototypeOf(table, null)

let saveTimer = null
function persist() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      const tmp = `${DATA_FILE}.tmp`
      writeFileSync(tmp, JSON.stringify(db))
      renameSync(tmp, DATA_FILE)
    } catch (err) {
      console.error('[aquaplan] persist failed:', err.message)
    }
  }, 200)
}

const sessionSweep = setInterval(() => {
  const now = Date.now()
  let dropped = 0
  for (const [token, s] of Object.entries(db.sessions)) {
    if (!s || s.expiresAt <= now) {
      delete db.sessions[token]
      dropped++
    }
  }
  if (dropped > 0) persist()
}, 60 * 60 * 1000)
sessionSweep.unref?.()

// -------------------------------------------------------------- rate limiting

/** Sliding-window counters, self-pruning. Key → { count, resetAt }. */
const buckets = new Map()

function bump(key, windowMs) {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count++
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  }
  return b.count
}

function countOf(key) {
  const b = buckets.get(key)
  return b && b.resetAt > Date.now() ? b.count : 0
}

const tooMany = (res, msg = 'Too many requests — wait a minute and try again.') =>
  res.status(429).json({ error: msg })

// ---------------------------------------------------------------- validation

const USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SLOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

function validDateISO(d) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(y, m - 1, day)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day
}

/** Same rules the client enforces for share-link payloads. Returns def or null. */
function sanitizeEventDef(body) {
  if (typeof body !== 'object' || body === null) return null
  const { name, description, dates, startMinutes, endMinutes, slotMinutes, timezone } = body
  if (typeof name !== 'string' || name.trim() === '') return null
  if (!Array.isArray(dates) || dates.length === 0 || dates.length > 100) return null
  if (!dates.every(validDateISO)) return null
  if (![15, 30, 60].includes(slotMinutes)) return null
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes)) return null
  if (startMinutes < 0 || startMinutes >= endMinutes || endMinutes > 1440) return null
  if (endMinutes - startMinutes < slotMinutes) return null
  return {
    name: name.trim().slice(0, 80),
    description:
      typeof description === 'string' && description.trim() !== ''
        ? description.trim().slice(0, 200)
        : undefined,
    dates: [...new Set(dates)].sort(),
    startMinutes,
    endMinutes,
    slotMinutes,
    timezone: typeof timezone === 'string' ? timezone.slice(0, 64) : 'UTC',
  }
}

/** Valid slot keys for an event, as a Set for membership checks. */
function slotUniverse(ev) {
  const keys = new Set()
  for (const date of ev.dates) {
    for (let m = ev.startMinutes; m + ev.slotMinutes <= ev.endMinutes; m += ev.slotMinutes) {
      const h = String(Math.floor(m / 60)).padStart(2, '0')
      const mm = String(m % 60).padStart(2, '0')
      keys.add(`${date}T${h}:${mm}`)
    }
  }
  return keys
}

function sanitizeSlots(ev, slots) {
  if (!Array.isArray(slots) || slots.length > 10000) return null
  const universe = slotUniverse(ev)
  const clean = new Set()
  for (const s of slots) {
    if (typeof s !== 'string' || !SLOT_RE.test(s)) return null
    if (universe.has(s)) clean.add(s)
  }
  return [...clean].sort()
}

function sanitizeName(name) {
  if (typeof name !== 'string') return null
  const n = name.trim().slice(0, 40)
  return n === '' ? null : n
}

// ---------------------------------------------------------------- auth utils

async function hashPassword(password, salt) {
  const buf = await scrypt(password, salt, 32)
  return buf.toString('hex')
}

function getCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

function setSessionCookie(res, token, req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`,
  )
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

function createSession(userId) {
  const token = randomBytes(32).toString('hex')
  db.sessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL_MS }
  persist()
  return token
}

function findUserByName(username) {
  if (typeof username !== 'string') return undefined
  const lower = username.toLowerCase()
  return Object.values(db.users).find((u) => u.usernameLower === lower)
}

function publicUser(user) {
  return { id: user.id, username: user.username }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------- responses

/** Resolve an event id, following one level of moved-from alias. */
function findEvent(id) {
  if (typeof id !== 'string') return undefined
  return db.events[id] ?? (db.aliases[id] ? db.events[db.aliases[id]] : undefined)
}

function makeResponse(key, name, slots, userId, rid) {
  return {
    key,
    rid: rid ?? randomBytes(8).toString('hex'),
    name,
    slots,
    userId: userId ?? null,
    updatedAt: Date.now(),
  }
}

/**
 * Public projection of an event. Replies expose only the opaque rid, display
 * name, slots, and two safe flags — never userId or the internal u:/g: key.
 */
function eventPayload(ev, user) {
  const owner = db.users[ev.ownerId]
  return {
    id: ev.id,
    name: ev.name,
    description: ev.description,
    dates: ev.dates,
    startMinutes: ev.startMinutes,
    endMinutes: ev.endMinutes,
    slotMinutes: ev.slotMinutes,
    timezone: ev.timezone,
    createdAt: ev.createdAt,
    ownerName: owner ? owner.username : 'unknown',
    mine: !!user && ev.ownerId === user.id,
    responses: ev.responses.map((r) => ({
      id: r.rid,
      name: r.name,
      slots: r.slots,
      updatedAt: r.updatedAt,
      registered: !!r.userId,
      self: !!user && !!r.userId && r.userId === user.id,
    })),
  }
}

// ---------------------------------------------------------------------- app

export function createApp() {
  const app = express()
  if (process.env.TRUST_PROXY) app.set('trust proxy', true)
  app.use(express.json({ limit: '1mb' }))

  // Same-origin guard for mutating requests (defense on top of SameSite=Lax).
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
    const origin = req.headers.origin
    if (origin) {
      let host = null
      try {
        host = new URL(origin).host
      } catch {
        // Malformed origin — reject below.
      }
      if (host !== req.headers.host) {
        return res.status(403).json({ error: 'Cross-origin request rejected.' })
      }
    }
    next()
  })

  // Resolve the session user (sliding expiry).
  app.use((req, res, next) => {
    req.user = null
    const token = getCookie(req, SESSION_COOKIE)
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const session = db.sessions[token]
      if (session && session.expiresAt > Date.now()) {
        const user = db.users[session.userId]
        if (user) {
          req.user = user
          if (session.expiresAt - Date.now() < SESSION_TTL_MS - SESSION_REFRESH_MS) {
            session.expiresAt = Date.now() + SESSION_TTL_MS
            persist()
          }
        }
      } else if (session) {
        delete db.sessions[token]
        persist()
      }
    }
    next()
  })

  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to do that.' })
    next()
  }

  // ------------------------------------------------------------------- auth

  app.post('/api/auth/register', async (req, res) => {
    if (bump(`reg:${req.ip}`, 60_000) > 5) return tooMany(res)
    const { username, password } = req.body ?? {}
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return res
        .status(400)
        .json({ error: 'Username must be 3–24 characters: letters, digits, - or _.' })
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' })
    }
    if (Object.keys(db.users).length >= MAX_USERS) {
      return res.status(503).json({ error: 'Registration is full on this server.' })
    }
    if (findUserByName(username)) {
      return res.status(409).json({ error: 'That username is taken.' })
    }
    const salt = randomBytes(16).toString('hex')
    const hash = await hashPassword(password, salt)
    // Re-check after the await: a concurrent register for the same name could
    // have landed while scrypt was running.
    if (findUserByName(username)) {
      return res.status(409).json({ error: 'That username is taken.' })
    }
    const user = {
      id: randomBytes(8).toString('hex'),
      username,
      usernameLower: username.toLowerCase(),
      salt,
      hash,
      createdAt: Date.now(),
    }
    db.users[user.id] = user
    const token = createSession(user.id)
    setSessionCookie(res, token, req)
    res.json({ user: publicUser(user) })
  })

  app.post('/api/auth/login', async (req, res) => {
    if (bump(`login:${req.ip}`, 60_000) > 10) return tooMany(res)
    const { username, password } = req.body ?? {}
    const failKey =
      typeof username === 'string' ? `fail:${username.toLowerCase().slice(0, 24)}` : 'fail:'
    if (countOf(failKey) >= 5) {
      return tooMany(res, 'Too many failed attempts for this account — wait a few minutes.')
    }
    const user = findUserByName(username)
    if (!user || typeof password !== 'string') {
      bump(failKey, 5 * 60_000)
      await delay(150 + Math.random() * 200)
      return res.status(401).json({ error: 'Wrong username or password.' })
    }
    const hash = await hashPassword(password, user.salt)
    const ok =
      hash.length === user.hash.length &&
      timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'))
    if (!ok) {
      bump(failKey, 5 * 60_000)
      await delay(150 + Math.random() * 200)
      return res.status(401).json({ error: 'Wrong username or password.' })
    }
    const token = createSession(user.id)
    setSessionCookie(res, token, req)
    res.json({ user: publicUser(user) })
  })

  app.post('/api/auth/logout', (req, res) => {
    const token = getCookie(req, SESSION_COOKIE)
    if (token && db.sessions[token]) {
      delete db.sessions[token]
      persist()
    }
    clearSessionCookie(res)
    res.json({ ok: true })
  })

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null })
  })

  // ----------------------------------------------------------------- events

  app.get('/api/events', requireAuth, (req, res) => {
    const mine = Object.values(db.events)
      .filter(
        (ev) => ev.ownerId === req.user.id || ev.responses.some((r) => r.userId === req.user.id),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((ev) => ({
        id: ev.id,
        name: ev.name,
        dates: ev.dates,
        startMinutes: ev.startMinutes,
        endMinutes: ev.endMinutes,
        slotMinutes: ev.slotMinutes,
        timezone: ev.timezone,
        createdAt: ev.createdAt,
        mine: ev.ownerId === req.user.id,
        replyCount: ev.responses.length,
      }))
    res.json({ events: mine })
  })

  app.post('/api/events', requireAuth, (req, res) => {
    if (bump(`create:${req.user.id}`, 60_000) > 20) return tooMany(res)
    const def = sanitizeEventDef(req.body)
    if (!def) return res.status(400).json({ error: "That event definition isn't valid." })
    const ev = {
      ...def,
      id: randomBytes(5).toString('hex'),
      createdAt: Date.now(),
      ownerId: req.user.id,
      responses: [],
    }
    // Optional import of replies (used by "move this browser event to my
    // account"). Oversized imports fail loudly — silently dropping replies
    // would let the client delete the only copy.
    if (Array.isArray(req.body.responses)) {
      if (req.body.responses.length > MAX_IMPORT_RESPONSES) {
        return res
          .status(400)
          .json({ error: `Too many replies to import (max ${MAX_IMPORT_RESPONSES}).` })
      }
      for (const r of req.body.responses) {
        const name = sanitizeName(r?.name)
        const slots = name ? sanitizeSlots(ev, r?.slots) : null
        if (!name || !slots) {
          return res.status(400).json({ error: `Reply "${r?.name ?? '?'}" couldn't be imported.` })
        }
        // The creator's own reply stays attached to their account.
        const isCreator = name.toLowerCase() === req.user.usernameLower
        const key = isCreator ? `u:${req.user.id}` : `g:${name.toLowerCase()}`
        if (!ev.responses.some((existing) => existing.key === key)) {
          ev.responses.push(makeResponse(key, name, slots, isCreator ? req.user.id : null))
        }
      }
    }
    // Keep old share links working when a browser event moves to the server.
    const movedFrom = req.body.movedFrom
    if (typeof movedFrom === 'string' && ID_RE.test(movedFrom) && !db.events[movedFrom]) {
      db.aliases[movedFrom] = ev.id
    }
    db.events[ev.id] = ev
    persist()
    res.json({ event: eventPayload(ev, req.user) })
  })

  app.get('/api/events/:id', (req, res) => {
    const ev = findEvent(req.params.id)
    if (!ev) return res.status(404).json({ error: 'No such event.' })
    res.json({ event: eventPayload(ev, req.user) })
  })

  app.delete('/api/events/:id', requireAuth, (req, res) => {
    const ev = findEvent(req.params.id)
    if (!ev) return res.status(404).json({ error: 'No such event.' })
    if (ev.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Only the organizer can delete an event.' })
    }
    delete db.events[ev.id]
    for (const [oldId, target] of Object.entries(db.aliases)) {
      if (target === ev.id) delete db.aliases[oldId]
    }
    persist()
    res.json({ ok: true })
  })

  /**
   * Save (or replace) the caller's availability. Signed-in users are keyed by
   * account; guests by name — separate namespaces, so a guest can never
   * overwrite an account holder's reply. When a signed-in user saves, any
   * guest reply under the same name is absorbed (they're claiming their own
   * earlier guest reply — and any guest could already overwrite that entry).
   */
  app.put('/api/events/:id/responses', (req, res) => {
    if (bump(`resp:${req.ip}`, 60_000) > 30) return tooMany(res)
    const ev = findEvent(req.params.id)
    if (!ev) return res.status(404).json({ error: 'No such event.' })
    // The client sends the account it believes it's signed in as; if the
    // session died meanwhile, fail instead of silently writing a guest reply.
    const asUser = req.body?.asUser
    if (asUser !== undefined && (!req.user || req.user.id !== asUser)) {
      return res.status(401).json({ error: 'Your session has ended — sign in again.' })
    }
    const name = sanitizeName(req.body?.name) ?? (req.user ? req.user.username : null)
    if (!name) return res.status(400).json({ error: 'A name is required.' })
    const slots = sanitizeSlots(ev, req.body?.slots)
    if (slots === null) return res.status(400).json({ error: "Those slots aren't valid." })

    const key = req.user ? `u:${req.user.id}` : `g:${name.toLowerCase()}`
    if (req.user) {
      ev.responses = ev.responses.filter((r) => r.key !== `g:${name.toLowerCase()}`)
    }
    const idx = ev.responses.findIndex((r) => r.key === key)
    if (idx === -1) {
      if (ev.responses.length >= MAX_RESPONSES_PER_EVENT) {
        return tooMany(res, 'This event has reached its reply limit.')
      }
      ev.responses.push(makeResponse(key, name, slots, req.user ? req.user.id : null))
    } else {
      ev.responses[idx] = makeResponse(key, name, slots, req.user ? req.user.id : null, ev.responses[idx].rid)
    }
    persist()
    const saved = ev.responses.find((r) => r.key === key)
    res.json({ event: eventPayload(ev, req.user), responseId: saved.rid })
  })

  app.delete('/api/events/:id/responses/:rid', requireAuth, (req, res) => {
    const ev = findEvent(req.params.id)
    if (!ev) return res.status(404).json({ error: 'No such event.' })
    const found = ev.responses.find((r) => r.rid === req.params.rid)
    if (!found) return res.status(404).json({ error: 'No such reply.' })
    const isOwner = ev.ownerId === req.user.id
    const isSelf = found.userId === req.user.id
    if (!isOwner && !isSelf) {
      return res.status(403).json({ error: "You can't remove someone else's reply." })
    }
    ev.responses = ev.responses.filter((r) => r.rid !== req.params.rid)
    persist()
    res.json({ event: eventPayload(ev, req.user) })
  })

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'No such endpoint.' })
  })

  return app
}
