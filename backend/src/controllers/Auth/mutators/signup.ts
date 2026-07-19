import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { signup } from "@/src/lib/auth/session";
import { setAuthCookie } from "@/src/lib/authCookie";
import { loginRateLimit } from "@/src/lib/security/loginLimiter";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  first_name: z.string().max(80).optional(),
});

/**
 * Registration kill-switch.
 *
 * Enforced here rather than only in the UI: hiding the signup form stops honest
 * users, not anyone willing to POST to the endpoint directly. Defaults to CLOSED
 * so a fresh deploy that forgets the variable is shut, not open — the safe
 * direction for a control whose failure mode is unwanted accounts.
 *
 * Set SIGNUPS_OPEN=true in the backend .env to re-enable.
 */
function signupsOpen(): boolean {
  return process.env.SIGNUPS_OPEN === "true";
}

/**
 * Create an account: mints a per-user DEK wrapped under the KEK (§5.1), warms
 * the cache, and returns a session cookie. No email/account wall blocks capture
 * (§8.10) — the client can buffer captures locally and call this on first sync.
 */
const signupEndpoint: Endpoint = async (request, reply) => {
  if (!signupsOpen()) {
    // 403, not 404: the route exists and the refusal is deliberate. Parsing the
    // body first would leak which emails are already taken via the 409 below.
    return reply
      .status(403)
      .send({ message: "Registration is closed right now." });
  }

  const { email, password, first_name } = Body.parse(request.body);

  try {
    const result = await signup(email, password, first_name);
    setAuthCookie(reply, result.token);
    // HttpOnly cookie only — never echo the session token into a JSON body where
    // page JavaScript (and any XSS) can read it. See the note in login.ts.
    return reply.status(201).send({ id: result.userId, email });
  } catch (err) {
    if (err instanceof Error && err.message === "EMAIL_TAKEN") {
      return reply.status(409).send({ message: "Email already registered" });
    }
    throw err;
  }
};

signupEndpoint.httpMethod = "POST";
signupEndpoint.path = "/signup";
signupEndpoint.isPublic = true;
signupEndpoint.onRequest = [loginRateLimit];

export default signupEndpoint;
