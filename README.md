# Kuma — an ADHD-first task manager

A planner that assumes the hard part isn't listing what to do, it's starting.
The scheduler is deterministic and explains every placement in plain language;
the app works fully offline; and sensitive content is encrypted per-field under
per-user keys so a database breach yields ciphertext.

```
backend/    Fastify + Prisma + PostgreSQL — encrypted, breach-contained API
Frontend/   Next.js 15 + Ant Design — dark-first offline PWA
```

## What's here

**Capture and triage.** Anything typed goes to an inbox and is classified
algorithmically — type, dates via chrono, project suggestion — with no model
call. Triage shows what it inferred and lets you change it before filing.

**A deterministic scheduler.** Constraint solving over energy windows, protected
regions, task dependencies and a personal rhythm profile (session length, break
frequency, weekend flexibility, how hard you find starting versus stopping). It
proposes; you accept. Every block carries a reason, and there's one-tap undo.
No AI is involved in deciding when you work.

**Offline-first.** Reads come from a local IndexedDB store and writes go to an
outbox flushed in bulk. Server-authoritative delta sync with last-writer-wins,
tombstones for deletes, and a re-bootstrap protocol for clients that have been
away longer than tombstone retention.

**Integrations.** A plugin registry where every provider emits validated
canonical blocks and the platform does all persistence. Google Calendar, Google
Tasks, TickTick and ICS feeds today. Outbound requests go through an
SSRF-guarded fetch.

**Recurrence.** A focused RFC 5545 RRULE subset, hand-written and exhaustively
tested. Rules outside the subset are refused rather than half-understood.

**AI, strictly optional.** Duration/energy estimates, step suggestions, and
digest phrasing. Every one has a heuristic fallback, all are consent-gated, and
none can schedule anything.

## Security model

Breach containment, not zero-knowledge. Full detail in [SECURITY.md](SECURITY.md).

- Sensitive fields (task titles, note bodies, event titles, OAuth tokens) are
  AES-256-GCM ciphertext under a **per-user DEK**. Structural metadata
  (durations, deadlines, priorities, times) stays cleartext so the scheduler
  queries it without decrypting anything.
- Per-user DEKs are wrapped by a **root KEK** held only in process memory,
  loaded off-DB, splittable into two shares. Rotating it re-wraps DEKs, which is
  O(users) and cheap enough to do on suspicion.
- DEKs are unwrapped at login and cached **active-only**. Every cold unwrap and
  batch decrypt is rate-limited and audit-logged; the limiter caps *distinct
  users* per actor, so a takeover sweeping the user base trips it rather than
  completing.
- **Break-glass** (`yarn tsx scripts/break-glass.ts --confirm`) flushes every
  warm key and rotates the KEK.

A database-only breach yields ciphertext with no keys. A full takeover reaches
active users only, throttled and logged.

## Running it

**Backend** (needs PostgreSQL):

```bash
cd backend
yarn install
createdb bearry || psql -U postgres -c 'CREATE DATABASE bearry;'
yarn prisma migrate deploy
yarn dev                        # http://localhost:10003
```

`.env.example` lists every variable. `ROOT_KEK` and `JWT_SECRET` are required —
the server refuses to boot without them rather than starting in a state where it
cannot decrypt.

**Frontend:**

```bash
cd Frontend
npm install
npm run dev                     # http://localhost:20002
```

Signups are **closed by default**; set `SIGNUPS_OPEN=true` to open registration
(including for local test accounts).

## Tests

Node's built-in runner, no framework:

```bash
cd backend  && yarn test
cd Frontend && npm test
```

The pure-logic cores also have standalone verifiers under `backend/scripts/`
(`verify-crypto`, `verify-classifier`, `verify-scheduler`, `verify-ssrf`,
`verify-plugins`).

CI runs typecheck, lint, tests and build for both projects on **Node 20**,
matching production — see [CONTRIBUTING.md](CONTRIBUTING.md) for why that
version pin is load-bearing.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) documents the conventions here alongside the
specific failures that motivated each one.
