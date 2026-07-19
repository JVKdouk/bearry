// Compose a digest: gather → (Gemini if opted-in & configured) → template fallback.
import type { RequestCrypto } from "@/src/lib/crypto/requestCrypto";
import { gatherDigest } from "./gather";
import { buildPrompt, renderTemplate, type DigestRange } from "./build";
import { generateText, geminiEnabled } from "@/src/lib/ai/gemini";
import { isOn } from "@/src/lib/settings";

export async function composeDigest(
  userId: string,
  range: DigestRange,
  crypto: RequestCrypto,
  firstName: string | null,
): Promise<{ text: string; usedAI: boolean }> {
  const data = await gatherDigest(userId, range, crypto, firstName);

  // Gemini only with explicit per-user consent (decrypted text leaves the box).
  if (geminiEnabled() && (await isOn(userId, "digest_ai_consent"))) {
    try {
      const ai = await generateText(buildPrompt(data));
      if (ai) return { text: ai, usedAI: true };
    } catch {
      /* fall through to the deterministic template */
    }
  }
  return { text: renderTemplate(data), usedAI: false };
}
