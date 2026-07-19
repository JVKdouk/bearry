import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { resolveAccess, canRead, canManage } from "@/src/lib/sharing/access";

const Params = z.object({ id: z.string() });

/**
 * Who's on a shared list.
 *
 * Any member can see the roster (you should know who else can read your tasks),
 * but only the owner is told about the pending share links — a member has no
 * business with the tokens that grant access.
 */
const members: Endpoint = async (request) => {
  const { id } = Params.parse(request.params);
  const userId = request.user.id;

  const access = await resolveAccess(userId);
  if (!canRead(access, id)) throw new GenericError("List not found", 404);

  const project = await database.project.findUnique({
    where: { id },
    select: { userId: true, user: { select: { id: true, email: true, first_name: true } } },
  });
  if (!project) throw new GenericError("List not found", 404);

  const memberRows = await database.projectMember.findMany({
    where: { projectId: id, deletedAt: null },
    select: {
      userId: true,
      role: true,
      user: { select: { email: true, first_name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const people = [
    {
      userId: project.userId,
      role: "owner" as const,
      email: project.user.email,
      name: project.user.first_name,
      isOwner: true,
    },
    ...memberRows.map((m) => ({
      userId: m.userId,
      role: m.role,
      email: m.user.email,
      name: m.user.first_name,
      isOwner: false,
    })),
  ];

  const invites = canManage(access, id)
    ? await database.projectInvite.findMany({
        where: { projectId: id, revokedAt: null },
        select: { id: true, token: true, role: true },
      })
    : [];

  return { members: people, invites, canManage: canManage(access, id) };
};

members.httpMethod = "GET";
members.path = "/projects/:id/members";

export default members;
