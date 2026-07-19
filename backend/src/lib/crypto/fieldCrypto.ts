/**
 * Transparent field encryption (§5.8).
 *
 * This is the working equivalent of a Prisma client extension: endpoints call
 * `encryptRecord` before a write and `decryptRecord`/`decryptMany` after a read,
 * and the sensitive fields named in the field-map are sealed/opened under the
 * request user's DEK. We keep it as explicit helpers rather than hooking Prisma
 * internals so the DEK is threaded cleanly per request and the transform is easy
 * to audit and unit-test — the field-map (§ fieldMap.ts) is the single source of
 * truth for what's sensitive.
 *
 * Each field is bound to `userId:model:field` as AAD, so a ciphertext can't be
 * replayed onto a different user, model, or column even by someone with DB write
 * access.
 */

import { sealToString, openFromString } from "./aead";
import { encryptedFieldsFor } from "./fieldMap";

function aadFor(userId: string, model: string, field: string): Buffer {
  return Buffer.from(`${userId}:${model}:${field}`, "utf8");
}

/**
 * Return a copy of `data` with the model's sensitive fields sealed. Null/
 * undefined fields pass through untouched (an optional encrypted field stays
 * empty). Non-string values are JSON-stringified before sealing.
 */
export function encryptRecord<T extends Record<string, unknown>>(
  model: string,
  userId: string,
  dek: Buffer,
  data: T,
): T {
  const fields = encryptedFieldsFor(model);
  if (fields.length === 0) return data;

  const out: Record<string, unknown> = { ...data };
  for (const field of fields) {
    const value = out[field];
    if (value === null || value === undefined) continue;
    const plaintext = typeof value === "string" ? value : JSON.stringify(value);
    out[field] = sealToString(dek, plaintext, aadFor(userId, model, field));
  }
  return out as T;
}

/**
 * Return a copy of `row` with the model's sensitive fields opened. A field that
 * fails to decrypt (tampered, wrong key) throws — we never silently serve
 * garbage. `count` toward the decrypt budget is the caller's responsibility via
 * the DEK guard; this function is pure transform.
 */
export function decryptRecord<T extends Record<string, unknown>>(
  model: string,
  userId: string,
  dek: Buffer,
  row: T,
): T {
  const fields = encryptedFieldsFor(model);
  if (fields.length === 0) return row;

  const out: Record<string, unknown> = { ...row };
  for (const field of fields) {
    const value = out[field];
    if (value === null || value === undefined || typeof value !== "string") continue;
    out[field] = openFromString(dek, value, aadFor(userId, model, field));
  }
  return out as T;
}

/** Decrypt a batch of rows of the same model. */
export function decryptMany<T extends Record<string, unknown>>(
  model: string,
  userId: string,
  dek: Buffer,
  rows: T[],
): T[] {
  return rows.map((r) => decryptRecord(model, userId, dek, r));
}
