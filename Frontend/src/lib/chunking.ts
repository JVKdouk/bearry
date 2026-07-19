/**
 * Whether a task may be split across several sittings.
 *
 * Mirrors backend/src/lib/scheduler/chunking.ts — the planner is the one that
 * acts on this, but the drawer has to show the same answer it will reach, or
 * the toggle describes behaviour the user won't get. Small enough to duplicate
 * honestly; the tests on both sides pin the same threshold.
 */

/** At or above this many minutes, a task splits unless told otherwise. */
export const AUTO_CHUNK_MINUTES = 300;

/**
 * Should this task be split?
 *
 * An explicit true/false is the user's decision and always wins. null means
 * nobody has decided, and length decides instead.
 */
export function isChunkable(
  chunkable: boolean | null | undefined,
  estimatedDuration: number,
): boolean {
  if (chunkable !== null && chunkable !== undefined) return chunkable;
  return estimatedDuration >= AUTO_CHUNK_MINUTES;
}

/**
 * How the setting reads in the drawer.
 *
 * Says *why* when nobody has chosen, because "Split into sittings: on" next to
 * a switch the user never touched invites the question of who did.
 */
export function chunkingLabel(
  chunkable: boolean | null | undefined,
  estimatedDuration: number,
): string {
  const on = isChunkable(chunkable, estimatedDuration);
  if (chunkable === null || chunkable === undefined) {
    return on
      ? "Split across sittings — long enough that the planner will spread it"
      : "Kept in one sitting — short enough to do in one go";
  }
  return on ? "Split across sittings" : "Kept in one sitting";
}
