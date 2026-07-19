import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";

const Params = z.object({ token: z.string().min(10) });

/**
 * Join a project via a share link.
 *
 * Idempotent, and role-preserving on re-accept: clicking a link you've already
 * used just confirms your membership rather than erroring, and it never
 * downgrades a role you were later promoted to — an old "view" link shouldn't
 * demote an editor. The owner accepting their own link is a no-op, not a
 * membership row, because ownership already outranks membership.
 */
const accept: Endpoint = async (request) => {
  const { token } = Params.parse(request.params);
  const userId = request.user.id;

  const invite = await database.projectInvite.findUnique({
    where: { token },
    select: {
      role: true,
      revokedAt: true,
      expiresAt: true,
      createdById: true,
      project: { select: { id: true, userId: true, deletedAt: true } },
    },
  });
  if (!invite || invite.project.deletedAt) throw new GenericError("This link isn't valid", 404);
  if (invite.revokedAt) throw new GenericError("This link has been turned off", 410);
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    throw new GenericError("This link has expired", 410);
  }

  const projectId = invite.project.id;

  // The owner doesn't need a membership row — they already have full access.
  if (invite.project.userId === userId) {
    return { projectId, role: "owner", alreadyMember: true };
  }

  const existing = await database.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true, role: true, deletedAt: true },
  });

  if (existing && !existing.deletedAt) {
    // Already in. Never downgrade: if they're a write member and this is a view
    // link, leave them as write.
    const upgrade = existing.role === "view" && invite.role === "write";
    if (upgrade) {
      await database.projectMember.update({
        where: { id: existing.id },
        data: { role: "write" },
      });
    }
    return { projectId, role: upgrade ? "write" : existing.role, alreadyMember: true };
  }

  const member = await database.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: {
      projectId,
      userId,
      role: invite.role,
      invitedById: invite.createdById,
    },
    // Re-joining after being removed: revive the row with the link's role.
    update: { role: invite.role, deletedAt: null, invitedById: invite.createdById },
    select: { role: true },
  });

  return { projectId, role: member.role, alreadyMember: false };
};

accept.httpMethod = "POST";
accept.path = "/invites/:token/accept";

export default accept;
