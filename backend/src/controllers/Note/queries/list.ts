import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";

/** All notes (decrypted), newest first. */
const listNotes: Endpoint = async (request) => {
  const rows = await database.note.findMany({
    where: { userId: request.user.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  const crypto = await requestCrypto(request, Math.max(rows.length, 1));
  const notes = crypto.decryptMany("Note", rows as Record<string, unknown>[]).map((n) => ({
    id: n.id,
    title: n.title,
    bodyMarkdown: n.bodyMarkdown,
    updatedAt: n.updatedAt,
  }));
  return { notes };
};

listNotes.httpMethod = "GET";
listNotes.path = "/";

export default listNotes;
