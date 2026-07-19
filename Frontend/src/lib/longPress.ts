/**
 * Deciding when a press becomes a hold.
 *
 * The whole subtlety is telling a deliberate hold apart from the start of a
 * scroll or a tap. Get it wrong one way and long-press never fires; wrong the
 * other and every scroll that starts on a card enters selection mode, which is
 * infuriating on a touch list you're just trying to read.
 *
 * Pure and separate from the React hook so the two thresholds — how long, and
 * how far the finger may drift — can be tested directly rather than felt out by
 * hand on a device.
 */

/** How long a press must be held, in ms, before it counts as a long-press. */
export const HOLD_MS = 450;

/**
 * How far the pointer may move during the hold before it's treated as a scroll
 * or drag instead. Fingers are never perfectly still; this is the slack.
 */
export const MOVE_TOLERANCE_PX = 10;

/** Has the pointer moved far enough to no longer be a hold? */
export function movedTooFar(
  start: { x: number; y: number },
  current: { x: number; y: number },
  tolerance = MOVE_TOLERANCE_PX,
): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  // Compare squared distances to avoid a sqrt on every move event.
  return dx * dx + dy * dy > tolerance * tolerance;
}
