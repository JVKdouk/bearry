import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { resolveBacklinks } from "@/src/lib/links/backlinks";

const Params = z.object({ id: z.string() });

/** A note with its automatic backlinks (§8.7). */
const getNote: Endpoint = async (request) => {
  const { id } = Params.parse(request.params);
  const row = await database.note.findFirst({
    where: { id, userId: request.user.id, deletedAt: null },
  });
  if (!row) throw new GenericError("Note not found", 404);

  const crypto = await requestCrypto(request);
  const note = crypto.decrypt("Note", row as Record<string, unknown>);
  const backlinks = await resolveBacklinks(request.user.id, "note", id);

  return {
    id: note.id,
    title: note.title,
    bodyMarkdown: note.bodyMarkdown,
    updatedAt: note.updatedAt,
    backlinks,
  };
};

getNote.httpMethod = "GET";
getNote.path = "/:id";

export default getNote;
