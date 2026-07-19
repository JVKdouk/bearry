/**
 * Deciding, for one incoming block/step write, whether it's allowed and whose
 * key it's stored under.
 *
 * The invariant that keeps sharing tractable: **everything in a shared list is
 * stored under the list owner's userId and encrypted with the owner's key**,
 * regardless of which member wrote it. One list, one key. A member's edit is
 * re-sealed under the owner on the way in; the member's own client decrypted it
 * on the way out with the owner's key too.
 *
 * The consequence, and the one rule this enforces beyond "can you write here":
 * a block's owner never changes through sync. Moving a task between two of the
 * owner's own lists is fine (same owner). Moving it across an ownership
 * boundary — a member pulling a shared task into their private list, or pushing
 * a private task into someone else's shared list — would mean re-keying it
 * under a different user, and is refused. v1 keeps content where it was
 * created.
 */

export type Decision =
  | { allowed: true; ownerId: string }
  | { allowed: false; reason: string };

export interface AccessView {
  owns: (projectId: string) => boolean;
  /** The granted role on a project, or undefined if not a member. */
  roleOn: (projectId: string) => "view" | "write" | undefined;
}

/**
 * May `actor` write a block, and under whose key is it stored?
 *
 * `existing` is the block's current `{ userId, projectId }` if it already
 * exists, else null (a create). `nextProjectId` is what the write sets the
 * project to (undefined = the write doesn't touch the project).
 *
 * `ownerOf` resolves a project's owner id; it's passed in so this stays pure.
 */
export function authorizeBlockWrite(
  actor: string,
  access: AccessView,
  existing: { userId: string; projectId: string | null } | null,
  nextProjectId: string | null | undefined,
  ownerOf: (projectId: string) => string | null,
): Decision {
  // --- creating a new block ------------------------------------------------
  if (!existing) {
    const projectId = nextProjectId ?? null;
    if (projectId === null) return { allowed: true, ownerId: actor }; // personal, no list
    if (access.owns(projectId)) return { allowed: true, ownerId: actor };
    if (access.roleOn(projectId) === "write") {
      const owner = ownerOf(projectId);
      // A write member creates under the owner's key, tagged with themselves as
      // author (createdById) so "added by" survives.
      return owner ? { allowed: true, ownerId: owner } : { allowed: false, reason: "list has no owner" };
    }
    return { allowed: false, reason: "no write access to that list" };
  }

  // --- editing an existing block -------------------------------------------
  const currentProject = existing.projectId;

  // Can the actor write the block as it stands? Either they own the content
  // (personal, userId === actor) or the block's current list is shared to them
  // with write.
  const canWriteCurrent =
    existing.userId === actor ||
    (currentProject !== null && access.roleOn(currentProject) === "write") ||
    (currentProject !== null && access.owns(currentProject));
  if (!canWriteCurrent) return { allowed: false, reason: "no write access to this task" };

  // If the write doesn't move the block between lists, ownership is unchanged.
  if (nextProjectId === undefined || nextProjectId === currentProject) {
    return { allowed: true, ownerId: existing.userId };
  }

  // A move. The destination's owner must be the same as the block's current
  // owner — otherwise the block would have to be re-keyed under a different
  // user, which v1 refuses.
  const destOwner = nextProjectId === null ? existing.userId /* personal keeps its owner */ : ownerOf(nextProjectId);
  if (nextProjectId !== null && !access.owns(nextProjectId) && access.roleOn(nextProjectId) !== "write") {
    return { allowed: false, reason: "no write access to the destination list" };
  }
  if (destOwner !== existing.userId) {
    return { allowed: false, reason: "can't move a task between different owners' lists" };
  }
  return { allowed: true, ownerId: existing.userId };
}
