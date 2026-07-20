import dotenv from "dotenv";
dotenv.config({ quiet: true });

export const IS_DEV = (process.env.NODE_ENV || "development") == "development";

export const CONFIG = {
  NODE_ENV: process.env.NODE_ENV || "development",
  BASE_URL: process.env.FRONT_END_ORIGIN,
  IS_DEV: IS_DEV,

  DATABASE_URL: process.env.DATABASE_URL,

  // Web Push (VAPID). Optional: when unset, push is disabled and the ping sender
  // is a no-op — goals still notify locally while the app is open.
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || "mailto:admin@kuma.day",
};

/**
 * Fail fast at boot if security-critical configuration is missing or weak, so a
 * misconfigured deploy never starts serving with (e.g.) a guessable JWT secret.
 * Skipped under NODE_ENV=test where the harness supplies its own env.
 */
export function validateEnv(): void {
  if (process.env.NODE_ENV === "test") return;

  const errors: string[] = [];

  const jwt = process.env.JWT_SECRET;
  if (!jwt || jwt.length < 32) {
    errors.push(
      "JWT_SECRET must be set and at least 32 characters (generate: openssl rand -base64 48)",
    );
  }

  // Root KEK — the single trust anchor (§5.1). Held in process memory, loaded
  // from a secret kept off Postgres and off the DB host. Without it the server
  // can't unwrap any user DEK, so refuse to boot. Accept either a single
  // ROOT_KEK or two XOR shares (ROOT_KEK_SHARE_A/B, §14.1).
  const kekA = process.env.ROOT_KEK_SHARE_A ?? process.env.ROOT_KEK;
  if (!kekA) {
    errors.push(
      "ROOT_KEK (or ROOT_KEK_SHARE_A) must be set — the root key that wraps every user DEK (generate: openssl rand -base64 32)",
    );
  }

  if (!process.env.DATABASE_URL) errors.push("DATABASE_URL must be set");
  if (!process.env.FRONT_END_ORIGIN) errors.push("FRONT_END_ORIGIN must be set");

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n - ${errors.join("\n - ")}`,
    );
  }
}
