import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { resolveAccess, canManage } from "@/src/lib/sharing/access";

const Params = z.object({ id: z.string(), userId: z.string() });
const Body = z.object({ role: z.enum(["view", "write"]) });

/** Change a member's role. Owner only; the owner has no role to change. */
const setRole: Endpoint = async (request) => {
  const { id, userId: memberId } = Params.parse(request.params);
  const { role } = Body.parse(request.body);

  const access = await resolveAccess(request.user.id);
  if (!canManage(access, id)) throw new GenericError("Not your list to manage", 403);

  const { count } = await database.projectMember.updateMany({
    where: { projectId: id, userId: memberId, deletedAt: null },
    data: { role },
  });
  if (count === 0) throw new GenericError("Not a member of this list", 404);

  return { ok: true, userId: memberId, role };
};

setRole.httpMethod = "PATCH";
setRole.path = "/projects/:id/members/:userId";

export default setRole;
