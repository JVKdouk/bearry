import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { resolveAccess, canManage } from "@/src/lib/sharing/access";

const Params = z.object({ id: z.string(), userId: z.string() });

/**
 * Remove a member, or leave a list yourself.
 *
 * Two callers, one endpoint: the owner removing someone, or a member removing
 * themselves. Anyone else is refused. Soft-delete so it syncs — the member's
 * client sees the row vanish and drops the list from their sidebar.
 */
const removeMember: Endpoint = async (request) => {
  const { id, userId: memberId } = Params.parse(request.params);
  const actor = request.user.id;

  const access = await resolveAccess(actor);
  const isOwner = canManage(access, id);
  const isSelf = memberId === actor;
  if (!isOwner && !isSelf) throw new GenericError("Can't remove that member", 403);

  await database.projectMember.updateMany({
    where: { projectId: id, userId: memberId, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  return { ok: true, userId: memberId };
};

removeMember.httpMethod = "DELETE";
removeMember.path = "/projects/:id/members/:userId";

export default removeMember;
