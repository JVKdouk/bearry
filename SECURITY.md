# Security model

Breach containment, not zero-knowledge. The server can decrypt — it has to, to
schedule and to compose digests — so the goal is that any single compromise
yields as little as possible, loudly, and can be halted with one action.

This describes the controls actually in the code, with file references. It
replaces an earlier point-in-time audit that documented a Telegram digest
channel and an Expo mobile client, neither of which still exists.

## 1. What is encrypted, and what deliberately is not

**Encrypted per-field** under a per-user DEK (AES-256-GCM, `lib/crypto/`): task
titles and notes, note bodies, event titles/descriptions/locations, capture
content, integration credentials.

**Cleartext by design**: durations, deadlines, start/end times, priorities,
energy levels, status, and settings.

That split is the load-bearing decision. The scheduler runs over structural
metadata alone, so planning a week never decrypts a single title — which means
the decrypt rate limiter below can be set tight enough to be meaningful. If
times were encrypted, every plan would need a bulk decrypt and the limiter would
have to be loose enough to be useless.

The cost is honest: someone with database access learns *when* you are busy and
how much, but not *what* any of it is.

## 2. Key hierarchy

```
ROOT_KEK (process memory, off-DB, optionally two shares)
  └─ wraps ─> per-user DEK (stored wrapped, AAD-bound to the user id)
                └─ encrypts ─> field ciphertext
```

- The DEK is minted at signup and never stored unwrapped.
- `userId` is bound as AAD when wrapping, so a wrapped DEK cannot be
  transplanted onto another user's row.
- Rotating the KEK re-wraps DEKs only — O(users), content untouched. This is
  what makes rotation cheap enough to do on suspicion rather than as a project.
- The server refuses to boot without `ROOT_KEK` (`validateEnv`), rather than
  starting in a state where it cannot decrypt.

## 3. Active-only key cache

Unwrapped DEKs live in memory with a short TTL (`lib/crypto/keyCache.ts`). A
takeover at 3am reaches the keys of whoever was recently active, not the whole
user base. Every cold unwrap is a logged, rate-limited event.

## 4. Decrypt rate limiter — the anti-exfiltration control

`lib/security/rateLimiter.ts` caps, per actor per window:

- **distinct users** whose DEKs may be unwrapped (default 5)
- **records** decrypted (default 100,000)

The distinct-users cap is the one that matters. One user's own sync legitimately
decrypts many thousands of their rows, so a volume cap alone can't distinguish
normal use from a dump. Touching a sixth user in a minute cannot be normal for a
session-scoped actor, so a `SELECT *`-shaped sweep trips at five users
regardless of volume. Batch jobs (digests) run under whitelisted identities with
their own ceilings.

> **Single-node caveat.** The limiter is an in-process map. Across several API
> instances the effective ceiling multiplies by instance count. Moving these
> counters to Redis is the prerequisite for horizontal scaling — it is a
> correctness requirement for this control, not an optimisation.

## 5. Break-glass

```bash
cd backend && yarn tsx scripts/break-glass.ts --confirm
```

Flushes every warm DEK and rotates the root KEK, re-wrapping all stored DEKs.
Prints the new KEK once; it must go into the environment and the server must be
restarted immediately.

Safe to run on suspicion: it re-wraps keys, it does not touch content. All
sessions are invalidated.

## 6. Request-level controls

| Control | Where |
|---|---|
| Auth required by default; `isPublic` is an explicit opt-out | `core/server/router` |
| Every user-data query scoped by `userId`, incl. ownership checks before update-by-id | controllers, `lib/integrations/service.ts` |
| Sync writes restricted to a per-entity `writable` whitelist (`userId`/`id`/`version` are server-owned) | `lib/sync/registry.ts` |
| Zod validation on every body, `.strict()` at the plugin boundary | controllers, `lib/integrations/schema/blocks.ts` |
| Global per-IP rate limit (600/min) | `core/server/index.ts` |
| Tighter per-IP limiter on login/signup | `lib/security/loginLimiter.ts` |
| Per-user AI budget, charged in items | `lib/security/aiBudget.ts` |
| SSRF guard on all plugin fetches — blocks loopback/private/link-local/metadata, no redirects, size and timeout caps | `lib/integrations/safeFetch.ts` |
| Helmet headers, SameSite=Lax cookie, Origin CSRF check, TLS-only cookies in prod | `core/server/index.ts`, `core/middlewares/csrf.ts` |
| Overload shedding (503 + Retry-After) before per-request work | `core/middlewares/overload.ts` |
| Signups closed unless `SIGNUPS_OPEN=true`; the 403 precedes body parsing so a taken email can't be probed via the 409 | `controllers/Auth/mutators/signup.ts` |

The session token is returned **only** as an HttpOnly cookie and never echoed in
a response body — otherwise one XSS would exfiltrate a 30-day session.

## 7. Third-party model calls

Sending task content to Gemini is opt-in per user (`digest_ai_consent`, and the
AI settings tab). With consent off, deterministic local templates are used and
nothing leaves the server.

Where content does go into a prompt, it is framed as data with an explicit
instruction not to follow anything inside it. That mitigates prompt injection
without pretending to solve it — which is why nothing the model returns is ever
executed or used to schedule. The worst case for a successful injection is a
badly-worded digest.

## 8. Known limitations

Stated plainly rather than left implicit:

- **The offline store holds decrypted content** in IndexedDB. Anyone with the
  device (or same-origin script execution) can read the cached workspace. The
  session token is HttpOnly and not reachable from JS, but cached content is.
  This is the price of the app working on a plane.
- **Rate limiters are per-process.** See §4.
- **The server can read everything.** By design; this is breach containment, not
  end-to-end encryption. A malicious operator is out of scope.
- **`emailFromIdToken` decodes without verifying the signature.** The token
  comes straight from Google's token endpoint over TLS, and the claim is used
  only as a local label and dedupe key — never for an authorization decision.

## 9. Reporting

Security issues: joao@kdouk.com.
