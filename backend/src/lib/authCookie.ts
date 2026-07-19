/**
 * Session cookie contract, shared by the auth middleware and the auth
 * controller so the name and attributes never drift apart.
 *
 * `SameSite=Lax` is the primary CSRF defense (the browser won't attach the
 * cookie to cross-site writes); the Origin/Referer check in `csrf.ts` is the
 * second layer. `HttpOnly` keeps the token out of JS. The mobile client stores
 * the token in the secure keystore and sends it as a cookie over TLS.
 */

import type { FastifyReply } from "fastify";

export const AUTH_COOKIE = "token";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days; sessions also expire in DB

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

export function setAuthCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    domain: process.env.COOKIE_DOMAIN || undefined,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearAuthCookie(reply: FastifyReply): void {
  reply.clearCookie(AUTH_COOKIE, { path: "/" });
}
