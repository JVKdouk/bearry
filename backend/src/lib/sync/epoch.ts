/**
 * The point before which a client's cursor means nothing.
 *
 * Delta sync assumes the client and server agree on what entities exist. When
 * `todo`, `calendarEvent` and `note` became `block`, that stopped being true
 * for every client already in the field: their local stores hold rows under
 * entity names the server no longer sends, and no amount of *delta* will ever
 * correct that — a delta says what changed, and "this entity is gone" is not a
 * change any row can express.
 *
 * So a cursor from before the change forces a full re-bootstrap, exactly as an
 * over-retention cursor does. The client throws its store away and refills it.
 *
 * This is deliberately a constant rather than a deploy timestamp read at boot:
 * it has to be identical across every server instance and stable across
 * restarts, or two instances would disagree about whether a given client needs
 * resetting and the client would flap between bootstrap and delta.
 */

/**
 * When the unified `blocks` entity replaced todo/calendarEvent/note.
 *
 * Any client whose cursor predates this is talking about a schema that no
 * longer exists. Later schema breaks should move this forward rather than
 * adding a second constant — one epoch, one meaning.
 */
export const SCHEMA_EPOCH = new Date("2026-07-19T00:00:00.000Z");

/**
 * Does this cursor predate the current entity layout?
 *
 * A null cursor is already a full bootstrap and needs no forcing.
 */
export function predatesSchemaEpoch(since: Date | null, epoch = SCHEMA_EPOCH): boolean {
  if (!since) return false;
  return since < epoch;
}
