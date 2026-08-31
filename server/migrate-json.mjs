/**
 * One-time import of the legacy JSON store into MongoDB.
 *
 *   pnpm migrate:json [path/to/aquaplan.json]
 *
 * Defaults to server/data/aquaplan.json (or $AQUAPLAN_DATA_DIR/aquaplan.json),
 * targeting the database in $MONGODB_URI / $AQUAPLAN_DB_NAME — the same
 * variables the server reads. Docs are upserted by id, so re-running after an
 * interruption is safe. The JSON file is left untouched.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { client, ensureIndexes, events, sessions, users } from './db.mjs'

const dataDir =
  process.env.AQUAPLAN_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const file = process.argv[2] ?? path.join(dataDir, 'aquaplan.json')

if (!existsSync(file)) {
  console.error(`[migrate] no JSON store at ${file} — nothing to import.`)
  process.exit(1)
}

const parsed = JSON.parse(readFileSync(file, 'utf8'))
const now = Date.now()
const counts = { users: 0, sessions: 0, sessionsExpired: 0, events: 0 }

await ensureIndexes()

for (const u of Object.values(parsed.users ?? {})) {
  const { id, ...rest } = u
  await users.updateOne({ _id: id }, { $set: rest }, { upsert: true })
  counts.users++
}

for (const [token, s] of Object.entries(parsed.sessions ?? {})) {
  if (!s || s.expiresAt <= now) {
    counts.sessionsExpired++
    continue
  }
  await sessions.updateOne(
    { _id: token },
    { $set: { userId: s.userId, expiresAt: new Date(s.expiresAt) } },
    { upsert: true },
  )
  counts.sessions++
}

// The standalone alias table becomes an `aliases` array on each event.
const aliasesByEvent = new Map()
for (const [oldId, target] of Object.entries(parsed.aliases ?? {})) {
  if (!aliasesByEvent.has(target)) aliasesByEvent.set(target, [])
  aliasesByEvent.get(target).push(oldId)
}

for (const ev of Object.values(parsed.events ?? {})) {
  const { id, responses: rawResponses, ...rest } = ev
  // Pre-rid replies (very old stores): move the public `id` to the internal
  // `key` and mint an opaque rid — the fix-up the JSON loader used to apply.
  const responses = (rawResponses ?? []).map((r) => {
    const copy = { ...r }
    if (copy.key === undefined && typeof copy.id === 'string') {
      copy.key = copy.id
      delete copy.id
    }
    if (typeof copy.rid !== 'string') copy.rid = randomBytes(8).toString('hex')
    return copy
  })
  await events.updateOne(
    { _id: id },
    {
      $set: { ...rest, responses, aliases: aliasesByEvent.get(id) ?? [] },
      $setOnInsert: { rev: 0 },
    },
    { upsert: true },
  )
  counts.events++
}

console.log(
  `[migrate] imported from ${file}: ` +
    `${counts.users} users, ${counts.events} events, ` +
    `${counts.sessions} sessions (${counts.sessionsExpired} expired dropped)`,
)
await client.close()
