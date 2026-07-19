/**
 * Whether a task may be split across several sittings.
 *
 * The old default was "never split unless told to", which is backwards for the
 * case that actually needs it: a 15-hour task with the flag unset went looking
 * for a single 15-hour gap, never found one, and reported itself unplaceable.
 * Nobody has a 15-hour gap. The tasks that genuinely can't be broken up — an
 * exam, a flight, a three-hour surgery — are the rare ones, and they're also
 * the ones whose owner knows to say so.
 *
 * So: short things stay whole (splitting a 40-minute task across two days is
 * worse than just doing it), long things split, and an explicit choice beats
 * both. The threshold is a real judgement call rather than a natural constant,
 * which is exactly why it lives in one named place.
 */

/**
 * At or above this many minutes, a task splits unless told otherwise.
 *
 * Five hours: longer than any working day has uninterrupted, and long enough
 * that "do it in one go" was never a real plan.
 */
export const AUTO_CHUNK_MINUTES = 300;

/**
 * Should this task be split?
 *
 * `chunkable` is three-valued on purpose. `true`/`false` are the user's
 * decision and always win — including "yes, split this 30-minute task", which
 * is unusual but theirs to make. `null`/`undefined` means nobody has decided,
 * and the duration rule applies.
 */
export function isChunkable(
  chunkable: boolean | null | undefined,
  estimatedDuration: number,
): boolean {
  if (chunkable !== null && chunkable !== undefined) return chunkable;
  return estimatedDuration >= AUTO_CHUNK_MINUTES;
}
