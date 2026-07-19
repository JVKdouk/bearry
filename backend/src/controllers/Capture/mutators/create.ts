import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { classify } from "@/src/lib/capture/classifier";

const Body = z.object({
  text: z.string().min(1).max(10_000),
  source: z.enum(["share", "email", "voice", "screenshot", "manual"]).default("manual"),
  senderDomain: z.string().optional(),
});

/**
 * Capture must be faster than the thought (§1.4 p1). One field, one call: the
 * raw content lands encrypted and Stage-1 triage runs synchronously (no model,
 * no decryption round-trip) so the item is immediately actionable in the inbox.
 */
const createCapture: Endpoint = async (request) => {
  const { text, source, senderDomain } = Body.parse(request.body);
  const crypto = await requestCrypto(request);

  // Suggest against the user's existing (decrypted) projects.
  const projectRows = await database.project.findMany({
    where: { userId: request.user.id, archived: false, deletedAt: null },
    select: { id: true, name: true },
  });
  const projects = crypto
    .decryptMany("Project", projectRows as Record<string, unknown>[])
    .map((p) => ({ id: p.id as string, keywords: String(p.name).toLowerCase().split(/\s+/) }));

  const result = classify({ text, source, senderDomain, projects });

  const stored = await database.captureItem.create({
    data: crypto.encrypt("CaptureItem", {
      userId: request.user.id,
      rawContent: text,
      source,
      proposedType: result.proposedType,
      suggestedProjectId: result.suggestedProjectId,
      extractedFields: JSON.stringify(result.extractedFields),
      confidence: result.confidence,
      classifierVersion: result.classifierVersion,
      status: "pending",
    }),
    select: { id: true, createdAt: true },
  });

  // Return the decrypted triage view so the client shows it instantly.
  return {
    id: stored.id,
    createdAt: stored.createdAt,
    proposedType: result.proposedType,
    suggestedProjectId: result.suggestedProjectId,
    extractedFields: result.extractedFields,
    confidence: result.confidence,
    classifierVersion: result.classifierVersion,
  };
};

createCapture.httpMethod = "POST";
createCapture.path = "/";

export default createCapture;
