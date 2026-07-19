/**
 * Transactional email (§10 digests), via Nodemailer.
 *
 * Gmail is the primary transport: set GMAIL_USER and GMAIL_APP_PASSWORD and it
 * uses Google's SMTP directly. Generic MAILER_* SMTP still works and takes over
 * when Gmail isn't configured, which keeps the local MailHog dev setup working
 * unchanged.
 *
 * GMAIL_APP_PASSWORD must be a Google **App Password** (16 characters, from
 * myaccount.google.com/apppasswords with 2FA enabled) — Google has blocked
 * plain account passwords over SMTP since 2022, and using one fails with a
 * confusing "Username and Password not accepted".
 */

import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

function gmailConfigured(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export function emailEnabled(): boolean {
  return gmailConfigured() || !!process.env.MAILER_HOST;
}

/** Which transport is in play — surfaced in settings so the state is visible. */
export function emailTransport(): "gmail" | "smtp" | "none" {
  if (gmailConfigured()) return "gmail";
  if (process.env.MAILER_HOST) return "smtp";
  return "none";
}

function getTransport(): Transporter {
  if (transporter) return transporter;

  if (gmailConfigured()) {
    transporter = nodemailer.createTransport({
      service: "gmail", // resolves host/port/TLS for us
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
    return transporter;
  }

  const port = Number(process.env.MAILER_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host: process.env.MAILER_HOST,
    port,
    // MailHog (1025) is plaintext; real providers on 465 use TLS.
    secure: port === 465,
    auth:
      process.env.MAILER_USER && process.env.MAILER_PASSWORD
        ? { user: process.env.MAILER_USER, pass: process.env.MAILER_PASSWORD }
        : undefined,
  });
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  if (!emailEnabled()) throw new Error("No mail transport configured (set GMAIL_USER + GMAIL_APP_PASSWORD)");

  // Gmail rewrites the envelope sender to the authenticated account anyway, so
  // claiming a different From just gets it replaced (or the mail rejected).
  // Default to the account itself and let MAILER_FROM name the display name.
  const from = gmailConfigured()
    ? (process.env.MAILER_FROM ?? `Bearry <${process.env.GMAIL_USER}>`)
    : (process.env.MAILER_FROM ?? "Bearry <no-reply@bearry.app>");

  await getTransport().sendMail({ from, to, subject, text, html });
}

/** Verify the credentials actually work, for a settings-page health check. */
export async function verifyEmail(): Promise<{ ok: boolean; error?: string }> {
  if (!emailEnabled()) return { ok: false, error: "No mail transport configured" };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Verification failed" };
  }
}
