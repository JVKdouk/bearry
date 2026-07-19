# BearAI backend

Fastify + Prisma + PostgreSQL. Breach-contained, server-decryptable (§5). Built
through Phase 5.

## Architecture

- **Framework** (`core/`): Rails-style autoloaded controllers. Each folder in
  `src/controllers/<Name>/` with `queries/` (GET) and `mutators/` (writes)
  becomes a router; the endpoint's `path`/`httpMethod` define the route. Auth is
  applied to every non-`isPublic` endpoint.
- **Crypto** (`src/lib/crypto/`): `aead` (AES-256-GCM) → `kek` (envelope
  wrap/unwrap + rotation) → `keyCache` (active-only DEK cache) →
  `fieldCrypto`/`requestCrypto` (transparent per-field encrypt/decrypt bound to
  the request user's DEK, AAD = `userId:model:field`). `fieldMap` is the single
  source of truth for which fields are sensitive.
- **Security** (`src/lib/security/`): `dekGuard` (`getUserDEK` — cache hit or
  logged+rate-limited KEK unwrap), `rateLimiter` (distinct-user + record caps),
  `auditLog` (append-only, off-box mirror), `breakGlass` (flush + rotate).
- **Sync** (`src/lib/sync/`): registry-driven delta pull/push with LWW.
- **Capture** (`src/lib/capture/classifier.ts`): pure Stage-1 triage.
- **Scheduler** (`src/lib/scheduler/`): pure constraint solver + DB service.

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` `/auth/login` `/auth/logout` | Session + DEK lifecycle |
| GET | `/users/me` | Current user |
| POST | `/capture` | Capture → Stage-1 triage (encrypted) |
| GET | `/capture` | Inbox (pending, decrypted) |
| POST | `/capture/:id/accept` · `/capture/:id/dismiss` | One-tap triage |
| GET/POST/PATCH | `/todos` · `/todos/:id` | Nested todos |
| POST | `/todos/let-go` | Gentle bulk archive (recoverable) |
| GET | `/projects` | Projects + open counts |
| GET | `/notes` · `/notes/:id` | Notes + automatic backlinks |
| GET | `/calendar/events` | Grid: events + blocks + energy windows |
| POST | `/schedule/plan` · `/schedule/apply` · `/schedule/undo` | Auto-scheduler |
| GET | `/sync/pull` · POST `/sync/push` | Delta sync |
| — | (Google is now a plugin under `/integrations`, not a dedicated controller) | |
| GET | `/integrations` · POST `/:id/{connect,sync,disconnect}` · GET `/:id/auth-url` · GET `/schema` | Plugin system (registry-driven, canonical blocks) |

## Security hardening

- **Field encryption + breach containment** (§5): per-user DEKs, off-DB KEK,
  active-only cache, decrypt audit log + rate limiter, break-glass.
- **Auth**: scrypt verifier, HS256 session (pinned algo), constant-time login,
  **per-IP brute-force limiter** on `/auth/login|signup` (`loginLimiter.ts`).
- **Plugin SSRF guard** (`integrations/safeFetch.ts`): plugin fetches (e.g. an
  `.ics` URL) are restricted to public http(s) hosts — loopback, private ranges,
  link-local, and cloud-metadata IPs are refused; no redirects; hard timeout;
  response-size cap. Dev may set `INTEGRATIONS_ALLOW_PRIVATE=true` for local test
  feeds (never in production).
- **Authz**: every query is scoped by `userId`; client writes go through a
  per-entity writable whitelist (sync) or zod-validated bodies (no mass assignment).
- Helmet security headers, SameSite=Lax + Origin CSRF check, TLS-only cookies in prod.

## Env (dev)

`.env` ships dev `ROOT_KEK`/`JWT_SECRET`. Production must load the KEK from an
off-DB secret (ideally two `ROOT_KEK_SHARE_A/B` shares), move the DEK cache +
rate-limit counters into Redis, and must NOT set `INTEGRATIONS_ALLOW_PRIVATE`.

## Tests / verification

```bash
yarn tsx scripts/verify-crypto.ts       # AEAD, envelope, rotation, rate limiter
yarn tsx scripts/verify-classifier.ts   # Stage-1 triage
yarn tsx scripts/verify-scheduler.ts    # energy-aware placement, chunking, capacity
yarn tsx scripts/verify-plugins.ts      # manifest + strict block schema validation
yarn tsx scripts/verify-ssrf.ts         # SSRF guard blocks internal/metadata targets
```
