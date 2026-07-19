/**
 * Who can see and change a project, and the blocks inside it.
 *
 * The whole feature is an access-control problem, not a crypto one: shared
 * content stays encrypted under the owner's key and the server reads it the way
 * it reads the owner's personal lists. So the security of sharing lives here —
 * in one place that answers "may this user do this", against the membership
 * rows — rather than being scattered through the sync engine and the endpoints.
 *
 * A `MembershipMap` is resolved once per request (it's a small query) and the
 * pure predicates below read from it, so the rules are testable without a DB.
 */

import database from "@/core/database";

export type Role = "view" | "write";

/**
 * A user's relationship to the projects they can touch, resolved per request.
 *
 * `owned` and `member` are kept apart because the owner can do things a member
 * can't (delete the list, manage members), and conflating them is how a member
 * ends up able to remove the owner.
 */
export interface Access {
  /** Project ids the user owns outright. */
  owned: Set<string>;
  /** Project ids the user is a member of, with the granted role. */
  member: Map<string, Role>;
}

/** Every project id the user can read — owned or shared to them. */
export function readableProjectIds(access: Access): string[] {
  return [...access.owned, ...access.member.keys()];
}

/** May the user read this project (and its blocks)? */
export function canRead(access: Access, projectId: string): boolean {
  return access.owned.has(projectId) || access.member.has(projectId);
}

/**
 * May the user write blocks in this project?
 *
 * Owners always can; members only with the `write` role. A `null` projectId is
 * a block in no list at all — always the actor's own, so writable.
 */
export function canWrite(access: Access, projectId: string | null): boolean {
  if (projectId === null) return true;
  if (access.owned.has(projectId)) return true;
  return access.member.get(projectId) === "write";
}

/** Only the owner manages the list itself: sharing, roles, deletion. */
export function canManage(access: Access, projectId: string): boolean {
  return access.owned.has(projectId);
}

/**
 * Resolve a user's access in one round-trip.
 *
 * Owned projects and memberships are two small indexed reads. Cached per
 * request by the caller — a sync push of many ops shouldn't re-query it per op.
 */
export async function resolveAccess(userId: string): Promise<Access> {
  const [owned, memberships] = await Promise.all([
    database.project.findMany({
      where: { userId, deletedAt: null },
      select: { id: true },
    }),
    database.projectMember.findMany({
      where: { userId, deletedAt: null },
      select: { projectId: true, role: true },
    }),
  ]);

  return {
    owned: new Set(owned.map((p) => p.id)),
    member: new Map(memberships.map((m) => [m.projectId, m.role as Role])),
  };
}

/**
 * The owner of a project, for encrypting/decrypting its content.
 *
 * A block in a shared list is stored under the owner's key, so a member's write
 * has to be sealed with the owner's DEK, not the member's. This is the lookup
 * that finds whose key to use.
 */
export async function projectOwner(projectId: string): Promise<string | null> {
  const row = await database.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  return row?.userId ?? null;
}
