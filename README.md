# AquaPlan

A dark-mode, Frutiger Aero–styled group scheduling app — a modern take on
[WhenIsGood](https://whenisgood.net): create an event, share a link, everyone
paints the times they're free, and the best meeting time surfaces on a live
availability heatmap.

Built with React 19, TypeScript, Vite, Express, and pnpm. Sign in and events
live on the bundled server — one link, replies from any device. Or skip the
account and everything stays in your browser.

## Running it

```bash
pnpm install
pnpm dev        # dev server (frontend + API) on http://localhost:5173
pnpm build      # type-check + production build to dist/
pnpm start      # production server (dist/ + API) on http://localhost:8787
```

The API is an Express app (`server/app.mjs`) mounted straight into Vite's dev
server. Data lives in MongoDB: the server reads `MONGODB_URI` from the
environment or a project-root `.env` (gitignored; shell variables win), and
defaults to `mongodb://127.0.0.1:27017`. Database name comes from
`AQUAPLAN_DB_NAME` (default `aquaplan`).

```bash
# .env — point the app at a MongoDB Atlas cluster
MONGODB_URI="mongodb+srv://user:pass@cluster.xxxxx.mongodb.net"
```

No cluster? A local Docker container works fine — with no `MONGODB_URI` set,
the app connects to it out of the box:

```bash
docker run -d --name aquaplan-mongo --restart unless-stopped \
  -p 27017:27017 -v aquaplan-mongo-data:/data/db mongo:8
```

Upgrading from the old JSON-file storage? Import it once with
`pnpm migrate:json` (reads `server/data/aquaplan.json`, targets whatever
`MONGODB_URI` resolves to, safe to re-run; the file is left untouched and no
longer used).

## Accounts — the primary flow

- **Register / sign in** with just a username and password (scrypt-hashed,
  httpOnly cookie sessions — no email).
- Events you create are **saved to the server**: the invite link is short and
  works from any device, and replies land in the results automatically.
- Invitees **don't need an account** — they reply as guests keyed by name.
  Signed-in invitees are keyed by account, so their reply follows them across
  devices and nobody can overwrite it.
- The home page lists your account events plus anything browser-local.

## Guest mode — the fallback

Everything still works signed-out, exactly as before: events live in
`localStorage`, invite links carry the whole event definition encoded in the
URL, and cross-device replies travel as copy-paste **response codes** the
organizer imports. Signing in later offers a one-click **"move it to my
account"** that recreates a browser event on the server, replies included.

## How it works

- **Create** — name the event, pick days on a calendar (click or drag), choose a
  daily time window and slot size (15/30/60 min).
- **Respond** — invitees paint their free slots on a drag-to-paint grid
  (rectangle selection, keyboard accessible).
- **Decide** — the organizer sees a sequential-aqua heatmap (brighter = more
  people free), per-slot tooltips with who's free/busy, and a ranked
  "Best times" list that merges consecutive slots with the same group.
- **Timezones** — a picker on the event and respond pages converts every
  displayed time (grid, tooltips, chips, best times) into any IANA zone,
  DST-correct via `Intl`, with `+1` markers where a window rolls past
  midnight. Defaults to your local zone and persists.

## Layout

```
server/
  app.mjs          Express API: auth (scrypt + cookie sessions), events,
                   responses
  db.mjs           MongoDB connection, document shapes, indexes
  migrate-json.mjs one-time import of the legacy JSON store
  index.mjs        production entry: serves dist/ + the API
src/
  lib/        time math, share-link + response-code codecs, localStorage store,
              API client, auth store, remote-event hook, best-times analysis,
              heatmap ramp
  components/ TimeGrid (paint + heatmap), MonthPicker, TimezonePicker,
              Aurora backdrop, CopyField
  pages/      Home, Create, Login, EventPage (results), Respond
```
