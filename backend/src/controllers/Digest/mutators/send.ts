import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import GenericError from "@/core/server/errors/generic";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { composeDigest } from "@/src/lib/digest/compose";
import { mdLiteToHtml, emailShell } from "@/src/lib/digest/build";
import { sendEmail, emailEnabled } from "@/src/lib/email/send";

const Body = z.object({ range: z.enum(["day", "week"]).default("day") });

/** Compose and email the digest to the user's account address now. */
const send: Endpoint = async (request) => {
  const { range } = Body.parse(request.body ?? {});
  if (!emailEnabled()) throw new GenericError("Email is not configured on the server", 503);

  const crypto = await requestCrypto(request, 100);
  const { text, usedAI } = await composeDigest(request.user.id, range, crypto, request.user.first_name);
  const subject = range === "day" ? "Your day with BearAI ☀️" : "Your week with BearAI 🗓️";
  try {
    await sendEmail(request.user.email, subject, emailShell(mdLiteToHtml(text)), text);
  } catch (err) {
    // SMTP/connection failures shouldn't 500 — surface a clean, safe message.
    console.error("Digest email send failed", err);
    throw new GenericError("Couldn’t reach the mail server. Please try again later.", 502);
  }
  return { sent: true, usedAI, to: request.user.email };
};

send.httpMethod = "POST";
send.path = "/send";

export default send;
