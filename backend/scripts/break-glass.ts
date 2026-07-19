/**
 * Operator entry point for break-glass revocation (§5.4).
 *
 * SECURITY.md has described this capability for a long time, but nothing could
 * invoke it: the implementation existed with zero callers, so the documented
 * emergency procedure was not actually executable. During an incident is the
 * worst possible time to discover that.
 *
 *   yarn tsx scripts/break-glass.ts --confirm
 *
 * What it does: flushes every warm DEK so nothing is decryptable without a fresh
 * unwrap, then rotates the root KEK and re-wraps every stored DEK under it. A
 * stolen KEK is useless afterwards. Content is never re-encrypted, so the cost
 * is O(users), not O(rows).
 *
 * Afterwards you MUST put the new KEK in the environment and restart, or the
 * next boot cannot unwrap anything. The new key is printed once and never
 * stored — losing it means losing every user's data.
 */

import "@/core/config";
import { breakGlass } from "@/src/lib/security/breakGlass";
import { randomBytes, KEY_BYTES } from "@/src/lib/crypto/aead";

async function main(): Promise<void> {
  // Requiring the flag stops a stray `tsx scripts/` or a shell-history recall
  // from rotating production keys by accident.
  if (!process.argv.includes("--confirm")) {
    console.error(
      [
        "Break-glass rotates the root KEK and invalidates every active session.",
        "",
        "This is safe to run on suspicion — it re-wraps keys, it does not touch",
        "content — but it WILL log every user out and requires updating the",
        "server environment immediately afterwards.",
        "",
        "Re-run with --confirm to proceed.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const newKek = randomBytes(KEY_BYTES);
  const started = Date.now();
  const result = await breakGlass(newKek);

  console.info("Break-glass complete:", {
    ...result,
    elapsedMs: Date.now() - started,
  });
  console.info(
    [
      "",
      "=== NEW ROOT KEK — SHOWN ONCE ===",
      newKek.toString("base64"),
      "=================================",
      "",
      "Set this as ROOT_KEK (or ROOT_KEK_SHARE_A, clearing ROOT_KEK_SHARE_B —",
      "this script mints a single whole key, not a share pair) and restart the",
      "server NOW. Until you do, the running process holds the new KEK only in",
      "memory, and a restart will be unable to unwrap any DEK.",
    ].join("\n"),
  );
}

main().catch((err) => {
  // A partial rotation is the dangerous outcome: some DEKs re-wrapped, some not.
  // Say so loudly rather than exiting quietly non-zero.
  console.error("BREAK-GLASS FAILED — rotation may be PARTIAL. Do not restart", err);
  process.exitCode = 1;
});
