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
server, so `pnpm dev` is all you need. Data persists to
`server/data/aquaplan.json` (gitignored).

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
  app.mjs     Express API: auth (scrypt + cookie sessions), events, responses;
              JSON-file persistence with atomic debounced writes
  index.mjs   production entry: serves dist/ + the API
src/
  lib/        time math, share-link + response-code codecs, localStorage store,
              API client, auth store, remote-event hook, best-times analysis,
              heatmap ramp
  components/ TimeGrid (paint + heatmap), MonthPicker, TimezonePicker,
              Aurora backdrop, CopyField
  pages/      Home, Create, Login, EventPage (results), Respond
```
