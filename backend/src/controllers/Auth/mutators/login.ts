import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { login } from "@/src/lib/auth/session";
import { setAuthCookie } from "@/src/lib/authCookie";
import { loginRateLimit } from "@/src/lib/security/loginLimiter";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Verify credentials, unwrap the user's DEK, warm the active-only cache (§5.3),
 * and set the session cookie. Timing is kept uniform for unknown emails to avoid
 * leaking which addresses are registered.
 */
const loginEndpoint: Endpoint = async (request, reply) => {
  const { email, password } = Body.parse(request.body);

  try {
    const result = await login(email, password);
    setAuthCookie(reply, result.token);
    // The token goes back ONLY as the HttpOnly cookie. Echoing it in the body
    // would hand the same bearer credential to page JavaScript and undo the
    // point of HttpOnly — one XSS would exfiltrate a 30-day session.
    return reply.status(200).send({ id: result.userId, email });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_CREDENTIALS") {
      return reply.status(401).send({ message: "Invalid email or password" });
    }
    throw err;
  }
};

loginEndpoint.httpMethod = "POST";
loginEndpoint.path = "/login";
loginEndpoint.isPublic = true;
loginEndpoint.onRequest = [loginRateLimit];

export default loginEndpoint;
