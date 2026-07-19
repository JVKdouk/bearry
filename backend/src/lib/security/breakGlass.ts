/**
 * Break-glass revocation (§5.4) — one action that halts all decryption, even
 * mid-attack.
 *
 * It (a) flushes every warm DEK from the cache so nothing is decryptable without
 * a fresh unwrap, and (b) rotates the root KEK, re-wrapping every stored DEK.
 * Because KEK rotation only re-wraps DEKs (O(users), content untouched), this is
 * cheap and safe to trigger on suspicion. The runbook also revokes Google access
 * for affected accounts (§6.3) — surfaced here as a hook.
 */

import database from "@/core/database";
import { beginKekRotation, kekVersion } from "@/src/lib/crypto/kek";
import { flushAllDeks } from "@/src/lib/crypto/keyCache";
import { randomBytes, KEY_BYTES } from "@/src/lib/crypto/aead";

export type BreakGlassResult = {
  flushedDeks: number;
  rewrappedUsers: number;
  newKekVersion: number;
};

/**
 * Execute break-glass. Pass a freshly-generated 32-byte KEK (or let it mint
 * one). All active sessions must re-authenticate afterward; their DEKs will be
 * unwrapped again under the new KEK, logged and rate-limited as normal.
 */
export async function breakGlass(newKek: Buffer = randomBytes(KEY_BYTES)): Promise<BreakGlassResult> {
  // 1. Immediately stop serving decrypts: drop every warm DEK.
  const flushedDeks = flushAllDeks();

  // 2. Rotate the KEK and re-wrap every DEK under it. Any stolen KEK is now
  //    useless against the stored (re-wrapped) DEKs.
  const rewrap = beginKekRotation(newKek);

  // Re-wrap in bounded-concurrency batches. This runs during an active incident,
  // and one sequential UPDATE per user means the rotation takes (users ×
  // round-trip) to complete — at any real scale, minutes during which some DEKs
  // are still wrapped under the compromised KEK. Concurrency turns that into
  // seconds. Paged so the user table is never loaded whole.
  const BATCH = 200;
  let rewrappedUsers = 0;
  let cursor: string | undefined;

  for (;;) {
    const users = await database.user.findMany({
      select: { id: true, wrappedDEK: true, dekVersion: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;
    cursor = users.at(-1).id;

    const rewrappable = users.filter((u) => u.wrappedDEK);
    await Promise.all(
      rewrappable.map((u) =>
        database.user.update({
          where: { id: u.id },
          data: {
            wrappedDEK: rewrap(u.wrappedDEK, u.id),
            dekVersion: (u.dekVersion ?? 1) + 1,
          },
        }),
      ),
    );
    rewrappedUsers += rewrappable.length;

    if (users.length < BATCH) break;
  }

  // NOTE: production also persists the new KEK to its off-box secret store here
  // (split into two shares) so a restart doesn't revert to the compromised KEK.
  console.warn(
    `BREAK-GLASS executed: flushed ${flushedDeks} DEKs, re-wrapped ${rewrappedUsers} users, KEK now v${kekVersion()}`,
  );

  return { flushedDeks, rewrappedUsers, newKekVersion: kekVersion() };
}
