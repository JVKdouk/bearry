import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { resolveAccess, canManage } from "@/src/lib/sharing/access";

const Params = z.object({ id: z.string() });

/**
 * Turn off a share link.
 *
 * Revoking a link doesn't touch anyone who already accepted — their membership
 * is a separate, durable row. It only stops the link from admitting anyone new.
 */
const revokeInvite: Endpoint = async (request) => {
  const { id } = Params.parse(request.params);

  const invite = await database.projectInvite.findUnique({
    where: { id },
    select: { projectId: true },
  });
  if (!invite) throw new GenericError("Link not found", 404);

  const access = await resolveAccess(request.user.id);
  if (!canManage(access, invite.projectId)) throw new GenericError("Not your link", 403);

  await database.projectInvite.update({ where: { id }, data: { revokedAt: new Date() } });
  return { ok: true };
};

revokeInvite.httpMethod = "DELETE";
revokeInvite.path = "/invites/:id";

export default revokeInvite;
