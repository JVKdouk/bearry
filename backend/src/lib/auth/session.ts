/**
 * Session + DEK lifecycle (§5.3).
 *
 * Signup mints a random per-user DEK, wraps it under the KEK, and stores only
 * the wrapped form. Login verifies the password, unwraps the DEK once, and warms
 * the cache (active-only decryption). Logout evicts the DEK and expires the
 * session. Session tokens are short-lived JWTs (HS256) carrying only a session
 * id — the row in Postgres is the source of truth and can be revoked.
 */

import jwt from "jsonwebtoken";
import database from "@/core/database";
import { randomBytes, KEY_BYTES } from "@/src/lib/crypto/aead";
import { wrapDek } from "@/src/lib/crypto/kek";
import { putDek, evictDek } from "@/src/lib/crypto/keyCache";
import { unwrapDek } from "@/src/lib/crypto/kek";
import { evictCachedSession } from "./sessionCache";
import { hashPassword, verifyPassword } from "./password";
import { sessionExpiry } from "@/src/lib/authCookie";

function signSession(sessionId: string): string {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set");
  return jwt.sign({ sessionId }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "30d",
  });
}

export type AuthResult = { token: string; userId: string; sessionId: string };

/** Create a user with a fresh wrapped DEK, then log them in. */
export async function signup(
  email: string,
  password: string,
  firstName?: string,
): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await database.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) throw new Error("EMAIL_TAKEN");

  const verifier = await hashPassword(password);

  // Mint the per-user DEK and store it wrapped — the raw DEK never hits the DB.
  const user = await database.user.create({
    data: {
      email: normalizedEmail,
      passwordVerifier: verifier,
      first_name: firstName ?? null,
      wrappedDEK: "", // placeholder; set below now that we have the id for AAD
      dekVersion: 1,
    },
    select: { id: true },
  });

  const dek = randomBytes(KEY_BYTES);
  const wrapped = wrapDek(dek, user.id);
  await database.user.update({ where: { id: user.id }, data: { wrappedDEK: wrapped } });

  const session = await createSession(user.id);
  putDek(user.id, dek); // warm immediately so the first request can encrypt
  return session;
}

/** Verify credentials, unwrap the DEK, warm the cache, mint a session. */
export async function login(email: string, password: string): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await database.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, passwordVerifier: true, wrappedDEK: true },
  });

  // Verify against a dummy hash on unknown email to keep timing uniform and
  // avoid leaking which addresses are registered.
  const verifierToCheck =
    user?.passwordVerifier ??
    "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const ok = await verifyPassword(password, verifierToCheck);
  if (!user || !ok) throw new Error("INVALID_CREDENTIALS");

  const dek = unwrapDek(user.wrappedDEK, user.id);
  putDek(user.id, dek);

  return createSession(user.id);
}

async function createSession(userId: string): Promise<AuthResult> {
  const session = await database.session.create({
    data: { userId, expires_at: sessionExpiry() },
    select: { id: true },
  });
  return { token: signSession(session.id), userId, sessionId: session.id };
}

/**
 * Evict the session and expire it — active-only decryption ends here.
 *
 * The DEK is only evicted when this was the user's LAST session. Dropping it
 * unconditionally would log a user out of their phone every time they closed a
 * laptop tab: the other session stays valid but its next request pays a fresh
 * KEK unwrap, which is exactly the audited, rate-limited operation we want to be
 * rare. Keeping the key warm while any session remains preserves the §5.3
 * property (warm == active) without punishing multi-device users.
 */
export async function logout(sessionId: string, userId: string): Promise<void> {
  evictCachedSession(sessionId);
  await database.session.deleteMany({ where: { id: sessionId } });

  const remaining = await database.session.count({
    where: { userId, expires_at: { gt: new Date() } },
  });
  if (remaining === 0) evictDek(userId);
}
