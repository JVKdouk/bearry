import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";

import errorHandler from "./errors";
import { createRouters, registerRouters } from "./router/register";
import mapEndpoints from "./endpoints";
import { csrfOriginCheck } from "@/core/middlewares/csrf";
import { overloadGuard, overloadRelease } from "@/core/middlewares/overload";
import { startSessionSweep } from "@/src/lib/sessionCleanup";
import type { SafeUser } from "@/core/middlewares/auth";

import "@/core/config";
import { validateEnv } from "@/core/config";
import { bootstrapKekFromEnv } from "@/src/lib/crypto/kek";
import { registerAllProviders } from "@/src/lib/integrations/providers";
import "@/core/logging";
import { reportTelemetryError } from "./telemetry";

declare module "fastify" {
  interface FastifyRequest {
    user: SafeUser;
    sessionId: string;
  }
}

export default async function startServer() {
  // Refuse to boot on missing/weak security-critical config.
  validateEnv();

  // Load the root KEK into process memory before any request can need to unwrap
  // a DEK (§5.1). Kept out of Postgres and off the DB host by construction.
  bootstrapKekFromEnv();

  // Register integration providers (Google Calendar, …) into the plugin registry.
  registerAllProviders();

  // trustProxy: behind the reverse proxy, read the client IP from
  // X-Forwarded-For so per-IP rate limits are per-user, not per-proxy.
  const fastify = Fastify({ trustProxy: true });

  // Security headers on every response (X-Content-Type-Options, X-Frame-Options,
  // Referrer-Policy, etc.). CSP is disabled — this is a JSON API that serves no
  // HTML, so a content policy is not applicable.
  fastify.register(helmet, { contentSecurityPolicy: false });

  // Global abuse/DoS rate limit per client IP. Credential brute-force is guarded
  // more tightly (by failures) in the login endpoint's own limiter.
  fastify.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
  });

  fastify.register(cors, {
    origin: process.env.FRONT_END_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  });

  fastify.register(multipart, {
    limits: { fileSize: 10_485_760, fieldNameSize: 300 },
  });

  // Financial JSON is per-user and dynamic — never let a proxy/browser cache it.
  fastify.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  // Fastify's default JSON parser rejects an empty body with a 400 ("Body cannot
  // be empty when content-type is set to 'application/json'"). Body-less requests
  // (logout, seed, recategorize, …) are legitimate, so treat an empty JSON body
  // as an empty object instead of an error.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      const raw = typeof body === "string" ? body : body.toString();
      if (raw.trim() === "") {
        done(null, {}); // empty JSON body → no fields, not an error
        return;
      }

      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error);
      }
    },
  );

  fastify.decorateRequest("user");
  fastify.register(cookie);

  // Shed load before doing any per-request work when the server is saturated,
  // answering 503 + Retry-After so clients back off instead of piling on.
  fastify.addHook("onRequest", overloadGuard);
  fastify.addHook("onResponse", overloadRelease);

  // CSRF defense-in-depth: reject cross-site state-changing requests. Runs on
  // every route (before auth), complementing the SameSite=Lax session cookie.
  fastify.addHook("onRequest", csrfOriginCheck);

  fastify.setErrorHandler(errorHandler);

  // Setup routes on fastify instance using autoload
  const controllerMap = await mapEndpoints();
  const routers = await createRouters(controllerMap);
  await registerRouters(routers, fastify);

  // Log route access if in development mode
  if (process.env.NODE_ENV === "development") {
    fastify.addHook("onRequest", (req, res, next) => {
      console.log(req.method, req.url);
      next();
    });
  }

  const port = Number(process.env.SERVER_PORT) || 3001;

  // Early return in test environments. Return the fastify instance so we can
  //  inject HTTP calls. See https://fastify.dev/docs/v1.14.x/Documentation/Testing/
  if (process.env.NODE_ENV == "test") {
    return fastify;
  }

  // Start server listener
  fastify.listen({ port, host: "0.0.0.0" }, function (err) {
    if (err) {
      reportTelemetryError(err);
      throw err.message;
    }

    console.info(`Server is running at http://0.0.0.0:${port}`);
    startSessionSweep();
  });
}
