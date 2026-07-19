import type { FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import database from "../database";
import { AuthenticationError } from "../server/errors/authenticationError";
import { AUTH_COOKIE } from "@/src/lib/authCookie";
import { getCachedSession, putCachedSession, evictCachedSession } from "@/src/lib/auth/sessionCache";

type JWTPayload = {
  sessionId: string;
};

/**
 * The authenticated principal attached to every request. Deliberately a subset
 * of the User row — the OPAQUE record and other sensitive columns are never
 * loaded, so they can't ride along in memory or be serialized by accident.
 */
export type SafeUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: Date;
};

export default async function handleAuth(req: FastifyRequest) {
  const token = req.cookies[AUTH_COOKIE];
  if (!token) throw new AuthenticationError("No token found.");

  if (!process.env.JWT_SECRET) throw new Error("JWT Token is not set");

  // A bad/expired/tampered token is a 401, not a 500. Pin HS256 to remove the
  // algorithm-confusion surface.
  let payload: JWTPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    }) as JWTPayload;
  } catch {
    throw new AuthenticationError("Invalid token");
  }

  // Hot path: this runs on every authenticated request, so serve it from the
  // short-TTL session cache when possible. Expiry is still checked against the
  // cached value, and logout evicts, so a cache hit is never more permissive
  // than the row it came from.
  const cached = getCachedSession(payload.sessionId);
  if (cached) {
    if (cached.expiresAt < new Date()) {
      evictCachedSession(payload.sessionId);
      throw new AuthenticationError("Token expired");
    }
    req.user = cached.user;
    req.sessionId = payload.sessionId;
    return;
  }

  // Select only safe user columns — the OPAQUE record never rides along.
  const sessionWithUser = await database.session.findUnique({
    where: {
      id: payload.sessionId,
    },
    select: {
      expires_at: true,
      user: {
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          created_at: true,
        },
      },
    },
  });

  if (!sessionWithUser || sessionWithUser.expires_at < new Date()) {
    throw new AuthenticationError("Token expired");
  }

  putCachedSession(payload.sessionId, sessionWithUser.user, sessionWithUser.expires_at);
  req.user = sessionWithUser.user;
  // The session id is the decrypt "actor" for the audit log + rate limiter
  // (§5.4): every field decryption on this request is attributed to it.
  req.sessionId = payload.sessionId;
}
