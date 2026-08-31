/**
 * MongoDB connection shared by the API, the production entry, and the JSON
 * import script.
 *
 * The client opens no sockets until the first command runs, so importing this
 * module — e.g. while Vite loads its config for `pnpm build` — never requires
 * a running database.
 *
 * Configuration (from the shell or a project-root .env, shell wins):
 *   MONGODB_URI       connection string (default mongodb://127.0.0.1:27017)
 *   AQUAPLAN_DB_NAME  database name     (default aquaplan)
 *
 * Document shapes:
 *   users     { _id, username, usernameLower, salt, hash, defaultTimezone?,
 *               createdAt }   — defaultTimezone: IANA zone captured at signup
 *               (or first sign-in after the feature shipped), never after
 *   sessions  { _id: token, userId, expiresAt: Date }   — TTL-indexed
 *   events    { _id, name, description?, dates, startMinutes, endMinutes,
 *               slotMinutes, timezone, createdAt, ownerId, responses: [],
 *               aliases: [], rev }
 *
 * `aliases` replaces the old standalone alias table: each event carries the
 * ids of browser events that were moved into it, so lookups are a single
 * indexed $or and aliases disappear with the event. `rev` guards the
 * read-modify-write reply upsert against concurrent writers.
 */
import { MongoClient } from 'mongodb'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Pull MONGODB_URI etc. from the project-root .env (gitignored). Variables
// already set in the shell take precedence; missing file is fine.
try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'))
} catch {
  // No .env — rely on the environment and defaults.
}

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017'
const dbName = process.env.AQUAPLAN_DB_NAME ?? 'aquaplan'

export const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 5000,
  ignoreUndefined: true,
})

const db = client.db(dbName)
export const users = db.collection('users')
export const sessions = db.collection('sessions')
export const events = db.collection('events')

let indexesReady = null

/** Idempotent; awaited before the first query, retried if the DB was down. */
export function ensureIndexes() {
  indexesReady ??= Promise.all([
    users.createIndex({ usernameLower: 1 }, { unique: true }),
    // TTL: mongod drops expired sessions shortly after expiresAt passes.
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    events.createIndex({ ownerId: 1 }),
    events.createIndex({ 'responses.userId': 1 }),
    events.createIndex({ aliases: 1 }),
  ]).catch((err) => {
    indexesReady = null
    throw err
  })
  return indexesReady
}
