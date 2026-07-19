import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * CSRF defense-in-depth: an Origin/Referer allowlist on state-changing requests.
 *
 * The session cookie is `SameSite=Lax`, which already stops the browser from
 * attaching it to cross-site sub-requests (forms/fetch) — the CSRF vector. This
 * hook is a second layer: for any non-safe method, if the request carries an
 * `Origin` (or `Referer`) that isn't our app origin, it is rejected. Requests
 * with neither header (non-browser clients, server-to-server) are allowed, since
 * the SameSite cookie is what protects browser sessions.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isAllowed(value: string | undefined, allowed: string): boolean {
  if (!value) return false;
  try {
    return new URL(value).origin === allowed;
  } catch {
    return false;
  }
}

export async function csrfOriginCheck(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (SAFE_METHODS.has(request.method)) return;

  const allowed = process.env.FRONT_END_ORIGIN;
  // If we don't know our own origin we can't safely allow cross-site writes.
  if (!allowed) return;

  const origin = request.headers.origin;
  const referer = request.headers.referer;

  // Browsers always send Origin on cross-origin (and same-origin) writes; prefer
  // it, fall back to Referer, and only allow header-less (non-browser) clients.
  if (origin !== undefined) {
    if (origin === allowed) return;
    return reply.status(403).send({ message: "Cross-site request blocked" });
  }
  if (referer !== undefined) {
    if (isAllowed(referer, allowed)) return;
    return reply.status(403).send({ message: "Cross-site request blocked" });
  }
}
