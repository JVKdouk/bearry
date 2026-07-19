/**
 * Gemini text generation (Google Generative Language API). Used to phrase the
 * daily/weekly digests. Gated behind GEMINI_API_KEY; callers fall back to a
 * deterministic template when it's absent or fails, so a digest always sends.
 *
 * PRIVACY: this sends decrypted schedule text to a third party (Google), so it
 * is strictly opt-in per user (the `digest_ai_consent` setting) — mirroring the
 * cloud-LLM opt-in in the security model (§9.7).
 */

import type { z } from "zod";
import { isOn } from "@/src/lib/settings";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 15_000;

/**
 * Cloud-LLM consent (§9.7). `ai_consent` covers the assist features; the older
 * `digest_ai_consent` still counts so users who already opted in for digests
 * aren't asked twice.
 */
export async function aiConsent(userId: string): Promise<boolean> {
  return (await isOn(userId, "ai_consent")) || (await isOn(userId, "digest_ai_consent"));
}

/** True when the model can actually be called for this user. */
export async function aiAvailable(userId: string): Promise<boolean> {
  return geminiEnabled() && (await aiConsent(userId));
}

/**
 * Generate and validate a structured answer. The model is asked for JSON, and
 * the result must satisfy `schema` — anything else returns null so every caller
 * falls back to its deterministic path instead of trusting loose output.
 */
export async function generateJSON<T>(
  prompt: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const raw = await generateText(prompt);
  if (!raw) return null;
  // Models still fence JSON occasionally despite instructions.
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const parsed = schema.safeParse(JSON.parse(cleaned));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function geminiEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export async function generateText(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 600 },
        // Keep the model from being derailed by content it's summarizing.
        safetySettings: [],
      }),
    });
    if (!res.ok) throw new Error(`Gemini responded ${res.status}`);
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } finally {
    clearTimeout(timer);
  }
}
