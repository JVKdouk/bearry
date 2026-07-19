# BearAI — ADHD-first productivity assistant

Standalone mobile app + breach-contained backend, implemented **through Phase 5**
of the technical spec (`BearAI_Mobile_Spec.md`): security foundation, data model &
sync, capture inbox, calendar & energy model, and the algorithmic auto-scheduler.

```
backend/   Fastify + Prisma + PostgreSQL — encrypted, breach-contained API
mobile/    Expo + React Native — dark-first, standalone client
```

## What's implemented (Phases 1–5)

| Phase | Area | Status |
|---|---|---|
| 1 | Field crypto (AES-256-GCM), KEK/DEK envelope + rotation, active-only key cache, scrypt auth + sessions, decrypt audit log, rate limiter, break-glass | ✅ built & verified |
| 2 | Full Prisma schema (encrypted/cleartext split), transparent field-crypto layer, server-authoritative delta sync (pull/push, LWW) | ✅ built |
| 3 | Capture pipeline (Stage-1 algorithmic classifier: type detection, chrono date parsing, project suggestion), inbox triage (accept/dismiss), projects, nested todos, notes, backlinks | ✅ built & verified |
| 4 | Calendar events + time blocks, energy windows (+ defaults), schedule profiles, Google OAuth token store (encrypted under DEK) | ✅ built |
| 5 | Algorithmic auto-scheduler — energy/capacity-aware placement, chunking, hard/soft constraints, plain-language explanations, one-tap undo | ✅ built & verified |

Later phases (ADHD "doing" layer, templates/reminders, quick-entry surfaces,
summary emails, AI enhancement, hardening/launch — Phases 6–10) are **not** built.

## Security model (breach containment, not zero-knowledge)

- Sensitive fields (task titles, note bodies, event titles, OAuth tokens) are
  AES-256-GCM ciphertext under a **per-user DEK**; structural metadata
  (durations, deadlines, priorities, times) stays cleartext so the scheduler
  queries it without decrypting.
- Per-user DEKs are wrapped by a **root KEK** held only in process memory,
  loaded off-DB, splittable into two shares. Rotating it re-wraps DEKs (cheap).
- DEKs are unwrapped at login and cached **active-only** (short TTL). Every cold
  unwrap / batch decrypt is **rate-limited + audit-logged**; **break-glass**
  flushes keys and rotates the KEK to halt all decryption.
- A DB-only breach yields ciphertext with no keys. A full takeover gets active
  users only, throttled and logged — contained, not catastrophic (§5, §12).

## Run it

**Backend** (needs PostgreSQL running):
```bash
cd backend
yarn install
# .env already has ROOT_KEK/JWT_SECRET for dev; DB is `bearry`
createdb bearry || psql -U postgres -c 'CREATE DATABASE bearry;'
yarn prisma migrate deploy      # or: yarn prisma migrate dev
yarn dev                        # http://localhost:10003

# Verify the pure-logic cores:
yarn tsx scripts/verify-crypto.ts
yarn tsx scripts/verify-classifier.ts
yarn tsx scripts/verify-scheduler.ts
```

**Mobile**:
```bash
cd mobile
npm install
# Point at your backend if not localhost:
EXPO_PUBLIC_API_BASE=http://<your-ip>:10003 npm start
```

See `backend/README.md` for the API surface and architecture notes.
