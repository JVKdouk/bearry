import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";

/** The inbox: pending captures, each with its pre-filled triage (§8.6). */
const listCaptures: Endpoint = async (request) => {
  const rows = await database.captureItem.findMany({
    where: { userId: request.user.id, status: "pending", deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const crypto = await requestCrypto(request, Math.max(rows.length, 1));
  const items = crypto.decryptMany("CaptureItem", rows as Record<string, unknown>[]).map((r) => ({
    id: r.id,
    rawContent: r.rawContent,
    source: r.source,
    proposedType: r.proposedType,
    suggestedProjectId: r.suggestedProjectId,
    extractedFields: r.extractedFields ? JSON.parse(String(r.extractedFields)) : null,
    confidence: r.confidence,
    classifierVersion: r.classifierVersion,
    createdAt: r.createdAt,
  }));

  return { items };
};

listCaptures.httpMethod = "GET";
listCaptures.path = "/";

export default listCaptures;
