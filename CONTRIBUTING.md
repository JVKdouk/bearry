# Working on Bearry

Conventions that exist because something went wrong without them. Each one names
the failure it prevents, so it's clear when a rule stops applying.

## Setup

```bash
cd backend  && yarn install && yarn prisma generate
cd Frontend && npm install
```

Two package managers is not a decision anyone would make from scratch; it's
where the projects landed. Keep each project on its own — mixing them produces
lockfile churn that hides real dependency changes in review.

## Before pushing

```bash
# backend
npx tsc --noEmit -p . && npx eslint ./src ./core ./tests && yarn test

# Frontend
npx tsc --noEmit && npx eslint . && npm test && npm run build
```

CI runs exactly these. It is pinned to **Node 20**, matching production.

### Node 20 is not a preference

Production runs Node v20.17. A dependency that builds on a newer local Node and
crashes on the server has already caused one outage here: `undici@8` bundled
`webidl.util.markAsUncloneable`, absent in 20.17, and the backend 502'd on boot.

Before adding a runtime dependency, check its engines field. CI on Node 20 is
what turns that class of mistake into a failed build instead of a live outage.

## Tests

Node's built-in runner in both projects (`tsx --test`). No framework.

**A test must exercise the real implementation.** Two tests here previously kept
their own copy of the logic they checked — a mapping "mirroring" the importer,
and an override resolver duplicated from its controller. Both would have passed
while the real code was broken. If testing something forces you to copy it,
export the real thing instead.

Name tests as claims about behaviour, not as labels for functions:

```
✗ test("parseRRule")
✓ test("monthly SKIPS months without that day, rather than inventing one")
```

The name is what a future reader sees when it fails, and it should tell them
what broke without reading the body.

## Comments

Comment the **why**, never the what. Self-evident code needs none, and a file
with no comments is fine when the code is plain.

Worth writing down: a decision that looks wrong until explained (Google Calendar
keeping server-side recurrence expansion), a constraint that isn't visible
locally (pm2 wiping env vars), a trap someone would otherwise re-introduce
(pruning tombstones without a resync protocol).

Not worth writing: `// increment the counter`.

## The one duplicated file

`backend/src/lib/recurrence/rrule.ts` has a byte-identical twin at
`Frontend/src/lib/recurrence/rrule.ts`, because the app is offline-first and the
client must expand recurrences with no server to ask.

Edit **the backend copy only**, then:

```bash
cd backend && npm run sync:rrule
```

`tests/recurrence-mirror.test.ts` fails the build if they drift. The frontend
linter is configured to ignore its copy, so the two `--fix` passes can't fight
over it.

## Database

Migrations are generated locally against a dev database:

```bash
cd backend && yarn prisma migrate dev
```

Production migrations go through an SSH tunnel — never point a migrate command
straight at the production host.

Every syncable model needs `@@index([userId, updatedAt])`. That is exactly the
shape of the sync pull query, and without it a delta pull degrades to a table
scan per entity per client.

## Security

- Routes authenticate by default. `isPublic = true` is an opt-out and every use
  should be obvious from the endpoint's purpose.
- Every query touching user data must be scoped by `userId`, including
  ownership checks before an update-by-id.
- New syncable fields must be added to the `writable` whitelist in
  `lib/sync/registry.ts` deliberately. `userId`, `id` and `version` are
  server-owned and must never appear there.
- Anything that spends money (model calls) charges `chargeAi` in item units
  before doing the work.

## Offline-first

Assume every user action can happen with no network.

- Reads come from the local store, never a fetch.
- Writes go through the sync outbox, which is bulk-flushed as one request.
- Distinguish "the server said no" (`ApiError` — retrying won't help) from "we
  couldn't reach it" (`OfflineError` — queue and retry). Conflating them is how
  offline apps either drop writes or retry rejected ones forever.
- Surface failures with `errText(err, fallback)` so the server's own explanation
  reaches the user instead of a generic message.
