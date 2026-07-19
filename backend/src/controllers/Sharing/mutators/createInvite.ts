import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { resolveAccess, canManage } from "@/src/lib/sharing/access";
import { mintToken } from "@/src/lib/sharing/invites";

const Params = z.object({ id: z.string() });
const Body = z.object({ role: z.enum(["view", "write"]).default("write") });

/**
 * Create a share link for a project the caller owns.
 *
 * One reusable link per role, not a fresh token every time: a second click of
 * "Share as editor" should hand back the same URL, or the owner ends up with a
 * drawer full of dead links they can't tell apart. Revoking is explicit.
 */
const createInvite: Endpoint = async (request) => {
  const { id } = Params.parse(request.params);
  const { role } = Body.parse(request.body);
  const userId = request.user.id;

  const access = await resolveAccess(userId);
  if (!canManage(access, id)) throw new GenericError("Not your list to share", 403);

  const existing = await database.projectInvite.findFirst({
    where: { projectId: id, role, revokedAt: null },
  });
  const invite =
    existing ??
    (await database.projectInvite.create({
      data: { projectId: id, role, token: mintToken(), createdById: userId },
    }));

  return { token: invite.token, role: invite.role };
};

createInvite.httpMethod = "POST";
createInvite.path = "/projects/:id/invites";

export default createInvite;
