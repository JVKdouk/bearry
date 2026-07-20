# Kuma — Frontend (PWA)

A desktop-first, installable **PWA** for the Kuma ADHD productivity assistant,
built with **Next.js (App Router) + Ant Design (dark theme)**, talking to the
Fastify backend.

## Stack

- **Next.js 15** (App Router, TypeScript)
- **Ant Design v5** — dark by default (`theme.darkAlgorithm`), violet-on-near-black
  "Kona" palette (`src/lib/theme.ts`)
- **Zustand** — offline-first sync store
- **dayjs** — dates
- **IndexedDB** — the offline store; reads never touch the network and writes
  queue in an outbox flushed in bulk
- `src/lib/recurrence/rrule.ts` is a **byte-identical mirror** of the backend's
  engine, so the calendar can expand repeats offline. Edit the backend copy and
  run `npm run sync:rrule` there; a test fails the build on drift.
- PWA: `public/manifest.webmanifest` + app-shell service worker (`public/sw.js`,
  registered in production only)

## Architecture

- **`src/lib/api.ts`** — typed fetch client. Auth is the backend's httpOnly
  `token` cookie, so every request uses `credentials: "include"`. The backend
  CORS allowlist must name this origin (`FRONT_END_ORIGIN`).
- **`src/store/sync.ts`** — the data layer. Mirrors the backend `/sync/pull` +
  `/sync/push` contract: local collections (10 syncable entities) are the UI's
  source of truth; writes are optimistic and flushed to the server via a
  coalescing outbox (keyed `entity:id`, debounced). A delta pull merges server
  changes (last-writer-wins, skipping locally-pending rows). Reads go through
  `useCollection(entity)` / `useRecord(entity, id)` (`src/store/hooks.ts`).
- **`src/store/auth.tsx`** — session context (`/users/me` + login/signup/logout);
  bootstraps the sync store on login.
- **`src/components/AppShell.tsx`** — responsive shell: desktop left sider,
  mobile top-bar + drawer. Guards unauthenticated users to `/login`.

### Screens (`src/app/(app)/…`)

| Route | What |
|-------|------|
| `/today` | Chronological buckets (Overdue/Today/Tomorrow/Upcoming/Anytime), collapsible |
| `/calendar` | Week/Day hourly grid; click a slot to create a timed item |
| `/lists` | All todos, filterable by list (project); create lists & tasks |
| `/inbox` | Capture (brain-dump) + triage each item to task/note/event/trash |
| `/plan` | "Plan my day/week" scheduler proposal → accept/undo, capacity meter |
| `/settings` | Integrations, Scheduling (time blocks + energy windows), Digests, Account |

The task create/edit surface is a shared drawer (`src/components/TaskDrawer.tsx`);
setting a date **and** time promotes a todo to a timed calendar block.

## Running

```bash
# 1. Backend must be running (default http://localhost:20001) with
#    FRONT_END_ORIGIN="http://localhost:3000" in backend/.env
npm install
npm run dev        # http://localhost:3000
```

Set `NEXT_PUBLIC_API_BASE` in `.env.local` to point at the backend
(default `http://localhost:20001`).

```bash
npm run build && npm start   # production (service worker active)
```

## Notes

- The service worker only caches the static app shell; all API traffic is
  always network — data consistency is owned by the sync store, not the SW.
- Uses `@ant-design/v5-patch-for-react-19` for React 19 compatibility.
