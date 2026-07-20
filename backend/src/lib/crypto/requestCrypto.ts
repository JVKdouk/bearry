/**
 * Per-request crypto context. One call resolves the user's DEK through the guard
 * (cache hit, or logged + rate-limited KEK unwrap) and returns bound helpers, so
 * endpoints read as `const c = await requestCrypto(req); c.encrypt("Block", data)`
 * without ever touching keys directly. The model name must be a live key in the
 * field map — a dead one ("Todo", "CalendarEvent") silently encrypts nothing and
 * stores plaintext, which then fails to open on read.
 */

import type { FastifyRequest } from "fastify";
import { getUserDEK, type DecryptActor } from "@/src/lib/security/dekGuard";
import { encryptRecord, decryptRecord, decryptMany } from "./fieldCrypto";
import { whitelistJobActor } from "@/src/lib/security/rateLimiter";

export type RequestCrypto = {
  userId: string;
  encrypt<T extends Record<string, unknown>>(model: string, data: T): T;
  decrypt<T extends Record<string, unknown>>(model: string, row: T): T;
  decryptMany<T extends Record<string, unknown>>(model: string, rows: T[]): T[];
};

/**
 * Build the crypto context for a request. `recordCount` lets a bulk read declare
 * how many rows it will decrypt so the rate limiter bounds volume (pass the row
 * count for a list endpoint).
 */
export async function requestCrypto(
  req: FastifyRequest,
  recordCount = 1,
): Promise<RequestCrypto> {
  const userId = req.user.id;
  const actor: DecryptActor = { sessionId: req.sessionId, context: `${req.method} ${req.url}` };
  const dek = await getUserDEK(userId, actor, recordCount);

  return {
    userId,
    encrypt: (model, data) => encryptRecord(model, userId, dek, data),
    decrypt: (model, row) => decryptRecord(model, userId, dek, row),
    decryptMany: (model, rows) => decryptMany(model, userId, dek, rows),
  };
}

/**
 * Crypto context for a scheduled job acting on a not-currently-active user
 * (§10.1). It unwraps the DEK under a whitelisted job actor so the batch runs
 * under its own audited, higher rate-limit ceiling.
 */
export async function jobCrypto(userId: string, jobActor: string, recordCount = 100): Promise<RequestCrypto> {
  whitelistJobActor(jobActor);
  const dek = await getUserDEK(userId, { sessionId: jobActor, context: jobActor }, recordCount);
  return {
    userId,
    encrypt: (model, data) => encryptRecord(model, userId, dek, data),
    decrypt: (model, row) => decryptRecord(model, userId, dek, row),
    decryptMany: (model, rows) => decryptMany(model, userId, dek, rows),
  };
}
