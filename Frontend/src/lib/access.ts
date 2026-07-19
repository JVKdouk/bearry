/**
 * What the current user may do with a project, worked out from synced rows.
 *
 * The server enforces all of this — a view member's write is refused whatever
 * the client believes. But the UI has to agree, or it offers buttons that
 * silently fail: a "New task" a viewer can't use, a delete that bounces. So the
 * same rules run here, over the projects and membership rows the client already
 * has, purely so the interface can hide what won't work.
 */

import type { Project, ProjectMember } from "./types";

export type Access = "owner" | "write" | "view" | null;

/**
 * The user's access to one project.
 *
 * Ownership wins over membership — you're never merely a viewer of your own
 * list, even if a stale membership row says otherwise. A project with no
 * `userId` is one you created before sharing existed, or a purely local draft;
 * either way it's yours.
 */
export function accessTo(
  project: Pick<Project, "id" | "userId"> | undefined,
  myUserId: string | undefined,
  members: Pick<ProjectMember, "projectId" | "userId" | "role" | "deletedAt">[],
): Access {
  if (!project) return null;
  // Personal / pre-sharing projects have no owner recorded and are the user's.
  if (!project.userId || project.userId === myUserId) return "owner";

  const mine = members.find(
    (m) => m.projectId === project.id && m.userId === myUserId && !m.deletedAt,
  );
  return mine ? mine.role : null;
}

/** Can the user add, edit, complete or delete tasks in this project? */
export function canEdit(access: Access): boolean {
  return access === "owner" || access === "write";
}

/** Is this a list shared *to* the user (not one they own)? */
export function isSharedToMe(access: Access): boolean {
  return access === "write" || access === "view";
}

/**
 * The people on a project, other than the current user, for the sidebar count
 * and the "shared" affordance. Deleted memberships don't count.
 */
export function otherMemberCount(
  projectId: string,
  myUserId: string | undefined,
  members: Pick<ProjectMember, "projectId" | "userId" | "deletedAt">[],
): number {
  return members.filter(
    (m) => m.projectId === projectId && m.userId !== myUserId && !m.deletedAt,
  ).length;
}
