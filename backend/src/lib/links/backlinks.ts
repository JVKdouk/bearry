/**
 * Backlink resolution (§8.7). Backlinks are automatic: given any entity, find
 * every Link that points *at* it, without the user ever creating the reverse
 * link. This externalizes memory (§1.4 p9) — the note you wrote last Tuesday
 * resurfaces where it's relevant instead of vanishing.
 */

import database from "@/core/database";

export type Backlink = {
  linkId: string;
  otherType: string;
  otherId: string;
  linkType: string;
  direction: "incoming" | "outgoing";
};

/** All links touching (fromId or toId) the given entity. */
export async function resolveBacklinks(
  userId: string,
  type: string,
  id: string,
): Promise<Backlink[]> {
  const links = await database.link.findMany({
    where: {
      userId,
      deletedAt: null,
      OR: [
        { fromType: type as never, fromId: id },
        { toType: type as never, toId: id },
      ],
    },
  });

  return links.map((l) => {
    const outgoing = l.fromType === (type as never) && l.fromId === id;
    return {
      linkId: l.id,
      otherType: outgoing ? l.toType : l.fromType,
      otherId: outgoing ? l.toId : l.fromId,
      linkType: l.linkType,
      direction: outgoing ? ("outgoing" as const) : ("incoming" as const),
    };
  });
}
