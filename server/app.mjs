/**
 * AquaPlan API — Express app factory shared by the Vite dev server (mounted as
 * middleware) and the production entry (server/index.mjs).
 *
 * Storage is MongoDB (see server/db.mjs for the connection, document shapes,
 * and indexes). Point MONGODB_URI at a local mongod or an Atlas cluster; the
 * legacy JSON store can be imported once with `pnpm migrate:json`.
 *
 * Response identity: internally each reply is keyed 'u:<userId>' (accounts) or
 * 'g:<nameLower>' (guests) for upserts, but the API only ever exposes a random
 * opaque `rid` per reply, so share-link viewers can't harvest stable account
 * ids or correlate users across events.
 */
import express from 'express'
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { ensureIndexes, events, sessions, users } from './db.mjs'

const scrypt = promisify(scryptCb)

const SESSION_COOKIE = 'aqsession'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000
const MAX_USERS = 1000
const MAX_RESPONSES_PER_EVENT = 300
const MAX_IMPORT_RESPONSES = 200

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

const EVENT_MODES = ['overlap', 'exclusive', 'schedule']

/** Same rules the client enforces for share-link payloads. Returns def or null. */
function sanitizeEventDef(body) {
  if (typeof body !== 'object' || body === null) return null
  const { name, description, mode, dates, startMinutes, endMinutes, slotMinutes, timezone } = body
  if (typeof name !== 'string' || name.trim() === '') return null
  if (mode !== undefined && !EVENT_MODES.includes(mode)) return null
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
    mode: mode ?? 'overlap',
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

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'YYYY-MM-DDTHH:MM' → 'Sep 3, 2:30 PM' (event-local wall clock), for error messages. */
function slotLabel(slot) {
  const [date, hm] = slot.split('T')
  const [, m, d] = date.split('-').map(Number)
  const [h, min] = hm.split(':').map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  const mm = String(min).padStart(2, '0')
  return `${MONTHS_SHORT[m - 1]} ${d}, ${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}

/** An IANA zone this Node's ICU accepts, or null. */
function sanitizeTimezone(tz) {
  if (typeof tz !== 'string' || tz === '' || tz.length > 64) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return null
  }
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

async function createSession(userId) {
  const token = randomBytes(32).toString('hex')
  await sessions.insertOne({
    _id: token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return token
}

function findUserByName(username) {
  if (typeof username !== 'string') return Promise.resolve(null)
  return users.findOne({ usernameLower: username.toLowerCase() })
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    defaultTimezone: user.defaultTimezone ?? null,
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------- responses

/** Resolve an event id — its own id or a moved-from alias it carries. */
function findEvent(id) {
  if (typeof id !== 'string') return Promise.resolve(null)
  return events.findOne({ $or: [{ _id: id }, { aliases: id }] })
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
async function eventPayload(ev, user) {
  const owner = await users.findOne({ _id: ev.ownerId })
  return {
    id: ev._id,
    name: ev.name,
    description: ev.description,
    mode: ev.mode ?? 'overlap',
    dates: ev.dates,
    startMinutes: ev.startMinutes,
    endMinutes: ev.endMinutes,
    slotMinutes: ev.slotMinutes,
    timezone: ev.timezone,
    createdAt: ev.createdAt,
    ownerName: owner ? owner.username : 'unknown',
    mine: !!user && ev.ownerId === user._id,
    responses: ev.responses.map((r) => ({
      id: r.rid,
      name: r.name,
      slots: r.slots,
      updatedAt: r.updatedAt,
      registered: !!r.userId,
      self: !!user && !!r.userId && r.userId === user._id,
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

  // Resolve the session user (sliding expiry). Scoped to /api so static asset
  // requests never touch the database.
  app.use('/api', async (req, res, next) => {
    await ensureIndexes()
    req.user = null
    const token = getCookie(req, SESSION_COOKIE)
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const session = await sessions.findOne({ _id: token })
      if (session && session.expiresAt > new Date()) {
        const user = await users.findOne({ _id: session.userId })
        if (user) {
          req.user = user
          if (session.expiresAt - Date.now() < SESSION_TTL_MS - SESSION_REFRESH_MS) {
            await sessions.updateOne(
              { _id: token },
              { $set: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } },
            )
          }
        }
      } else if (session) {
        await sessions.deleteOne({ _id: token })
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
    const { username, password, timezone } = req.body ?? {}
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return res
        .status(400)
        .json({ error: 'Username must be 3–24 characters: letters, digits, - or _.' })
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' })
    }
    if ((await users.estimatedDocumentCount()) >= MAX_USERS) {
      return res.status(503).json({ error: 'Registration is full on this server.' })
    }
    if (await findUserByName(username)) {
      return res.status(409).json({ error: 'That username is taken.' })
    }
    const salt = randomBytes(16).toString('hex')
    const hash = await hashPassword(password, salt)
    const user = {
      _id: randomBytes(8).toString('hex'),
      username,
      usernameLower: username.toLowerCase(),
      salt,
      hash,
      // Captured once at signup; undefined (field omitted, per ignoreUndefined)
      // when the client sent nothing valid — login backfills it later.
      defaultTimezone: sanitizeTimezone(timezone) ?? undefined,
      createdAt: Date.now(),
    }
    try {
      await users.insertOne(user)
    } catch (err) {
      // The unique index on usernameLower settles the race with a concurrent
      // register for the same name that landed while scrypt was running.
      if (err?.code === 11000) {
        return res.status(409).json({ error: 'That username is taken.' })
      }
      throw err
    }
    const token = await createSession(user._id)
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
    const user = await findUserByName(username)
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
    // Accounts from before defaultTimezone existed: capture the device zone on
    // their next sign-in. Set once — never overwritten by later sign-ins.
    if (!user.defaultTimezone) {
      const tz = sanitizeTimezone(req.body?.timezone)
      if (tz) {
        user.defaultTimezone = tz
        await users.updateOne({ _id: user._id }, { $set: { defaultTimezone: tz } })
      }
    }
    const token = await createSession(user._id)
    setSessionCookie(res, token, req)
    res.json({ user: publicUser(user) })
  })

  app.post('/api/auth/logout', async (req, res) => {
    const token = getCookie(req, SESSION_COOKIE)
    if (token) await sessions.deleteOne({ _id: token })
    clearSessionCookie(res)
    res.json({ ok: true })
  })

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null })
  })

  app.patch('/api/auth/me', requireAuth, async (req, res) => {
    if (bump(`settings:${req.user._id}`, 60_000) > 20) return tooMany(res)
    const tz = sanitizeTimezone(req.body?.defaultTimezone)
    if (!tz) return res.status(400).json({ error: "That timezone isn't valid." })
    await users.updateOne({ _id: req.user._id }, { $set: { defaultTimezone: tz } })
    res.json({ user: publicUser({ ...req.user, defaultTimezone: tz }) })
  })

  // ----------------------------------------------------------------- events

  app.get('/api/events', requireAuth, async (req, res) => {
    const mine = await events
      .find({ $or: [{ ownerId: req.user._id }, { 'responses.userId': req.user._id }] })
      .sort({ createdAt: -1 })
      .toArray()
    res.json({
      events: mine.map((ev) => ({
        id: ev._id,
        name: ev.name,
        mode: ev.mode ?? 'overlap',
        dates: ev.dates,
        startMinutes: ev.startMinutes,
        endMinutes: ev.endMinutes,
        slotMinutes: ev.slotMinutes,
        timezone: ev.timezone,
        createdAt: ev.createdAt,
        mine: ev.ownerId === req.user._id,
        replyCount: ev.responses.length,
      })),
    })
  })

  app.post('/api/events', requireAuth, async (req, res) => {
    if (bump(`create:${req.user._id}`, 60_000) > 20) return tooMany(res)
    const def = sanitizeEventDef(req.body)
    if (!def) return res.status(400).json({ error: "That event definition isn't valid." })
    const ev = {
      ...def,
      _id: randomBytes(5).toString('hex'),
      createdAt: Date.now(),
      ownerId: req.user._id,
      responses: [],
      aliases: [],
      rev: 0,
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
        const key = isCreator ? `u:${req.user._id}` : `g:${name.toLowerCase()}`
        if (!ev.responses.some((existing) => existing.key === key)) {
          ev.responses.push(makeResponse(key, name, slots, isCreator ? req.user._id : null))
        }
      }
    }
    // Keep old share links working when a browser event moves to the server.
    const movedFrom = req.body.movedFrom
    if (
      typeof movedFrom === 'string' &&
      ID_RE.test(movedFrom) &&
      !(await events.findOne({ _id: movedFrom }))
    ) {
      ev.aliases.push(movedFrom)
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await events.insertOne(ev)
        break
      } catch (err) {
        // A 40-bit id collision is nearly impossible — but retrying is free.
        if (err?.code === 11000 && attempt < 3) {
          ev._id = randomBytes(5).toString('hex')
          continue
        }
        throw err
      }
    }
    res.json({ event: await eventPayload(ev, req.user) })
  })

  app.get('/api/events/:id', async (req, res) => {
    const ev = await findEvent(req.params.id)
    if (!ev) return res.status(404).json({ error: 'No such event.' })
    res.json({ event: await eventPayload(ev, req.user) })
  })

  app.delete('/api/events/:id', requireAuth, async (req, res) => {
    const ev = await findEvent(req.params.id)
    if (!ev) return res.status(404).json({ error: 'No such event.' })
    if (ev.ownerId !== req.user._id) {
      return res.status(403).json({ error: 'Only the organizer can delete an event.' })
    }
    // Aliases live on the event doc, so they disappear with it.
    await events.deleteOne({ _id: ev._id })
    res.json({ ok: true })
  })

  /**
   * Save (or replace) the caller's availability. Signed-in users are keyed by
   * account; guests by name — separate namespaces, so a guest can never
   * overwrite an account holder's reply. When a signed-in user saves, any
   * guest reply under the same name is absorbed (they're claiming their own
   * earlier guest reply — and any guest could already overwrite that entry).
   *
   * The replies array is recomputed from a snapshot and written back guarded
   * by `rev`, so two concurrent savers can't overwrite each other's reply —
   * the loser of the race just retries on a fresh snapshot.
   */
  app.put('/api/events/:id/responses', async (req, res) => {
    if (bump(`resp:${req.ip}`, 60_000) > 30) return tooMany(res)
    for (let attempt = 0; attempt < 5; attempt++) {
      const ev = await findEvent(req.params.id)
      if (!ev) return res.status(404).json({ error: 'No such event.' })
      // The client sends the account it believes it's signed in as; if the
      // session died meanwhile, fail instead of silently writing a guest reply.
      const asUser = req.body?.asUser
      if (asUser !== undefined && (!req.user || req.user._id !== asUser)) {
        return res.status(401).json({ error: 'Your session has ended — sign in again.' })
      }
      const name = sanitizeName(req.body?.name) ?? (req.user ? req.user.username : null)
      if (!name) return res.status(400).json({ error: 'A name is required.' })
      const slots = sanitizeSlots(ev, req.body?.slots)
      if (slots === null) return res.status(400).json({ error: "Those slots aren't valid." })

      const key = req.user ? `u:${req.user._id}` : `g:${name.toLowerCase()}`
      let responses = req.user
        ? ev.responses.filter((r) => r.key !== `g:${name.toLowerCase()}`)
        : [...ev.responses]
      // Mutually-exclusive events: a slot can belong to only one person. The
      // check runs on the same snapshot the rev-guarded write uses, so a
      // conflicting reply can never land — the racer gets a 409 after retries.
      if ((ev.mode ?? 'overlap') === 'exclusive') {
        const taken = new Set()
        for (const r of responses) {
          if (r.key !== key) for (const s of r.slots) taken.add(s)
        }
        const clashes = slots.filter((s) => taken.has(s))
        if (clashes.length > 0) {
          const shown = clashes.slice(0, 3).map(slotLabel).join('; ')
          const more = clashes.length > 3 ? ` and ${clashes.length - 3} more` : ''
          return res.status(409).json({
            error: `Someone else already claimed ${shown}${more}.`,
          })
        }
      }
      const idx = responses.findIndex((r) => r.key === key)
      if (idx === -1) {
        if (responses.length >= MAX_RESPONSES_PER_EVENT) {
          return tooMany(res, 'This event has reached its reply limit.')
        }
        responses.push(makeResponse(key, name, slots, req.user ? req.user._id : null))
      } else {
        responses[idx] = makeResponse(
          key,
          name,
          slots,
          req.user ? req.user._id : null,
          responses[idx].rid,
        )
      }
      const result = await events.updateOne(
        { _id: ev._id, rev: ev.rev ?? null },
        { $set: { responses }, $inc: { rev: 1 } },
      )
      if (result.matchedCount === 1) {
        const saved = responses.find((r) => r.key === key)
        return res.json({
          event: await eventPayload({ ...ev, responses }, req.user),
          responseId: saved.rid,
        })
      }
      // Someone else's write landed between our read and write — retry.
    }
    res.status(503).json({ error: 'The event is busy — try again.' })
  })

  app.delete('/api/events/:id/responses/:rid', requireAuth, async (req, res) => {
    const ev = await findEvent(req.params.id)
    if (!ev) return res.status(404).json({ error: 'No such event.' })
    const found = ev.responses.find((r) => r.rid === req.params.rid)
    if (!found) return res.status(404).json({ error: 'No such reply.' })
    const isOwner = ev.ownerId === req.user._id
    const isSelf = found.userId === req.user._id
    if (!isOwner && !isSelf) {
      return res.status(403).json({ error: "You can't remove someone else's reply." })
    }
    // $pull is atomic per-rid, so no rev guard is needed; bump rev anyway so
    // a concurrent reply upsert sees the change and retries.
    const updated = await events.findOneAndUpdate(
      { _id: ev._id },
      { $pull: { responses: { rid: req.params.rid } }, $inc: { rev: 1 } },
      { returnDocument: 'after' },
    )
    if (!updated) return res.status(404).json({ error: 'No such event.' })
    res.json({ event: await eventPayload(updated, req.user) })
  })

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'No such endpoint.' })
  })

  // Async handler failures (e.g. the database is unreachable) end up here;
  // answer API callers in JSON instead of Express's HTML error page.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    console.error('[aquaplan]', err)
    res.status(500).json({ error: 'Server error — try again.' })
  })

  return app
}
