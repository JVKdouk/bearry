/**
 * Re-seal migrated blocks under their new model name.
 *
 * Encrypted fields are bound to `userId:Model:field` as additional
 * authenticated data. That binding is the point — it stops a ciphertext being
 * lifted from one column into another — but it also means the rows carried over
 * from `todos`, `calendar_events` and `notes` are sealed as `Todo:title`,
 * `CalendarEvent:description`, `Note:bodyMarkdown` and cannot be opened as
 * `Block:*`. The SQL migration deliberately left the ciphertext untouched and
 * recorded the old model name in `legacyAadModel`; this opens each field with
 * the name it was sealed under and re-seals it as `Block`.
 *
 * Three properties matter more than speed here, because the alternative to
 * getting this right is content nobody can ever read again:
 *
 *  • Resumable. `legacyAadModel` is cleared per row in the same write that
 *    stores the new ciphertext, so an interrupted run leaves every row either
 *    fully old or fully new — never half-converted.
 *  • Verifying. Every re-sealed value is opened again under the new AAD and
 *    compared to the plaintext before the row is written.
 *  • Refusing. A row that will not open under its legacy AAD is reported and
 *    skipped, never overwritten. A failure here means the assumption was wrong,
 *    and destroying the evidence would be the worst possible response.
 *
 * Run with --dry-run first. It reports exactly what it would do and writes
 * nothing.
 */

import database from "@/core/database";
import { bootstrapKekFromEnv } from "@/src/lib/crypto/kek";
import { getUserDEK } from "@/src/lib/security/dekGuard";
import { whitelistJobActor } from "@/src/lib/security/rateLimiter";
import { openFromString, sealToString } from "@/src/lib/crypto/aead";

const ACTOR = "job:reseal-blocks";

/**
 * Where each legacy field ended up on `blocks`.
 *
 * The column renames are as load-bearing as the model rename: a task's `notes`,
 * an event's `description` and a note's `bodyMarkdown` all became `body`, and
 * each was sealed under its *own* old field name.
 */
const FIELD_MAP: Record<string, { legacyField: string; column: "title" | "body" | "location" }[]> = {
  Todo: [
    { legacyField: "title", column: "title" },
    { legacyField: "notes", column: "body" },
  ],
  CalendarEvent: [
    { legacyField: "title", column: "title" },
    { legacyField: "description", column: "body" },
    { legacyField: "location", column: "location" },
  ],
  Note: [
    { legacyField: "title", column: "title" },
    { legacyField: "bodyMarkdown", column: "body" },
  ],
};

function aad(userId: string, model: string, field: string): Buffer {
  return Buffer.from(`${userId}:${model}:${field}`, "utf8");
}

export type ResealResult = {
  examined: number;
  resealed: number;
  skipped: number;
  failures: { id: string; field: string; reason: string }[];
};

export async function resealBlocks(dryRun = false): Promise<ResealResult> {
  const result: ResealResult = { examined: 0, resealed: 0, skipped: 0, failures: [] };
  whitelistJobActor(ACTOR);

  const pending = await database.block.findMany({
    where: { legacyAadModel: { not: null } },
    select: {
      id: true,
      userId: true,
      legacyAadModel: true,
      title: true,
      body: true,
      location: true,
    },
    orderBy: { id: "asc" },
  });

  // One DEK unwrap per user rather than per row: unwrapping is the expensive
  // part, and the decrypt limiter counts distinct users, not rows.
  const deks = new Map<string, Buffer>();

  for (const row of pending) {
    result.examined += 1;
    const legacy = row.legacyAadModel!;
    const fields = FIELD_MAP[legacy];
    if (!fields) {
      result.failures.push({ id: row.id, field: "-", reason: `unknown legacy model ${legacy}` });
      result.skipped += 1;
      continue;
    }

    let dek = deks.get(row.userId);
    if (!dek) {
      dek = await getUserDEK(row.userId, { sessionId: ACTOR, context: ACTOR }, pending.length);
      deks.set(row.userId, dek);
    }

    const patch: Record<string, string> = {};
    let failed = false;

    for (const { legacyField, column } of fields) {
      const value = row[column];
      // An absent optional field has nothing to re-seal. Empty strings are not
      // ciphertext either and would throw on open.
      if (value === null || value === undefined || value === "") continue;

      let plaintext: string;
      try {
        plaintext = openFromString(dek, value, aad(row.userId, legacy, legacyField));
      } catch (err) {
        result.failures.push({
          id: row.id,
          field: `${legacy}.${legacyField}`,
          reason: (err as Error).message,
        });
        failed = true;
        break;
      }

      const resealed = sealToString(dek, plaintext, aad(row.userId, "Block", column));

      // Prove it before trusting it. Sealing and storing without reading it
      // back means a mistake in the AAD surfaces later, on a row whose original
      // ciphertext is already gone.
      const roundTrip = openFromString(dek, resealed, aad(row.userId, "Block", column));
      if (roundTrip !== plaintext) {
        result.failures.push({ id: row.id, field: column, reason: "round-trip mismatch" });
        failed = true;
        break;
      }

      patch[column] = resealed;
    }

    if (failed) {
      // Left exactly as it was, legacyAadModel intact, so a fixed run can retry.
      result.skipped += 1;
      continue;
    }

    if (!dryRun) {
      await database.block.update({
        where: { id: row.id },
        data: {
          ...patch,
          // Cleared in the same write as the new ciphertext: the two must never
          // disagree, or a re-run would try to open Block-sealed data as Todo.
          legacyAadModel: null,
        },
      });
    }
    result.resealed += 1;
  }

  return result;
}

const isDirect = process.argv[1]?.includes("reseal-blocks");
if (isDirect) {
  const dryRun = process.argv.includes("--dry-run");
  bootstrapKekFromEnv();
  resealBlocks(dryRun)
    .then((r) => {
      console.info(dryRun ? "DRY RUN — nothing written" : "Reseal complete");
      console.info(`  examined: ${r.examined}`);
      console.info(`  resealed: ${r.resealed}`);
      console.info(`  skipped:  ${r.skipped}`);
      for (const f of r.failures) console.error(`  FAILED ${f.id} ${f.field}: ${f.reason}`);
      process.exit(r.failures.length > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("Reseal failed", err);
      process.exit(1);
    });
}
