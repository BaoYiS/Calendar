# AquaPlan

A dark-mode, Frutiger Aero–styled group scheduling app — a modern take on
[WhenIsGood](https://whenisgood.net): create an event, share a link, everyone
paints the times they're free, and the best meeting time surfaces on a live
availability heatmap.

Built with React 19, TypeScript, Vite, and pnpm. No backend, no accounts —
everything lives in the browser.

## Running it

```bash
pnpm install
pnpm dev        # dev server on http://localhost:5173
pnpm build      # type-check + production build to dist/
pnpm preview    # serve the production build
```

## How it works

- **Create** — name the event, pick days on a calendar (click or drag), choose a
  daily time window and slot size (15/30/60 min).
- **Share** — the invite link carries the whole event definition encoded in the
  URL, so it works even though there's no server.
- **Respond** — invitees paint their free slots on a drag-to-paint grid
  (rectangle selection, keyboard accessible), no account needed.
- **Decide** — the organizer sees a sequential-aqua heatmap (brighter = more
  people free), per-slot tooltips with who's free/busy, and a ranked
  "Best times" list that merges consecutive slots with the same group.

### Cross-device responses

There is no server, so responses can't sync automatically between devices.
Replies made in the organizer's own browser just work; anyone responding on
another device gets a short **response code** to send back, which the organizer
pastes into the event page to import. (Wire a real backend in
`src/lib/store.ts` if you outgrow this.)

## Layout

```
src/
  lib/        time math, share-link + response-code codecs, localStorage store,
              best-times analysis, heatmap ramp
  components/ TimeGrid (paint + heatmap), MonthPicker, Aurora backdrop, CopyField
  pages/      Home, Create, EventPage (results), Respond
```
