/**
 * Making and reading share tokens.
 *
 * A token is a URL-safe secret; holding it is the authorization to join, so it
 * has to be long enough that guessing is hopeless — 32 random bytes, ~256 bits.
 */

import { randomBytes } from "node:crypto";
import database from "@/core/database";
import { jobCrypto } from "@/src/lib/crypto/requestCrypto";
import { whitelistJobActor } from "@/src/lib/security/rateLimiter";

export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface InvitePreview {
  token: string;
  role: "view" | "write";
  listName: string;
  color: string;
  icon: string | null;
  /** True when the link is no longer usable — the UI says why rather than 404. */
  expired: boolean;
  revoked: boolean;
}

/**
 * What to show someone who clicked a share link, before they accept.
 *
 * The list name is encrypted under the owner's key, so decrypting it for an
 * anonymous request means unwrapping the owner's DEK under a whitelisted job
 * actor — bounded to this one field. Possession of the token is the license to
 * see it; that's the whole point of a share link.
 */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const invite = await database.projectInvite.findUnique({
    where: { token },
    select: {
      token: true,
      role: true,
      revokedAt: true,
      expiresAt: true,
      project: {
        select: { id: true, userId: true, name: true, color: true, icon: true, deletedAt: true },
      },
    },
  });
  if (!invite || invite.project.deletedAt) return null;

  const actor = "job:invite-preview";
  whitelistJobActor(actor);
  const crypto = await jobCrypto(invite.project.userId, actor, 1);
  const decrypted = crypto.decrypt("Project", invite.project as Record<string, unknown>);

  return {
    token: invite.token,
    role: invite.role,
    listName: String(decrypted.name ?? "Shared list"),
    color: invite.project.color,
    icon: invite.project.icon,
    revoked: !!invite.revokedAt,
    expired: !!invite.expiresAt && invite.expiresAt.getTime() < Date.now(),
  };
}
