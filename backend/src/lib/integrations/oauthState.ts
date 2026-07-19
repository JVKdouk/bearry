/**
 * Signed OAuth `state` — carries which user is connecting through the Google
 * consent redirect. The consent flow lands on a PUBLIC callback (Google calls it,
 * so there's no session cookie); the signed state is how the callback re-learns
 * the user id without trusting a query param. Short-lived and HMAC-signed with the
 * app's JWT secret, so it can't be forged or replayed after it expires.
 */
import jwt from "jsonwebtoken";

export type OAuthState = { userId: string; providerId: string };

export function signOAuthState(state: OAuthState): string {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set");
  return jwt.sign(state, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "10m" });
}

export function verifyOAuthState(token: string): OAuthState {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set");
  const p = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] }) as OAuthState;
  if (!p.userId || !p.providerId) throw new Error("invalid state");
  return { userId: p.userId, providerId: p.providerId };
}
