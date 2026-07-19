/**
 * Horizontal swipe-to-navigate, split from the component so the decisions it
 * makes are testable without a DOM.
 *
 * The hard part of a swipe isn't the translation, it's deciding what the user
 * meant. A calendar grid scrolls vertically and drags to create events, so a
 * gesture that grabs too eagerly steals scrolling; one that grabs too late
 * feels dead. The rules below are the arbitration.
 */

export interface SwipeConfig {
  /** Horizontal travel before we claim the gesture, in px. */
  claimAfter: number;
  /** Fraction of width past which release commits the move. */
  commitFraction: number;
  /** Speed (px/ms) that commits regardless of distance — a flick. */
  flickVelocity: number;
  /** Resistance applied past the ends, so over-swiping feels bounded. */
  overscrollDamping: number;
}

export const DEFAULT_SWIPE: SwipeConfig = {
  claimAfter: 12,
  commitFraction: 0.28,
  flickVelocity: 0.45,
  overscrollDamping: 0.35,
};

/**
 * Does this movement belong to a horizontal swipe?
 *
 * Requires both a minimum travel and a genuinely horizontal angle. Without the
 * angle test, a slightly-diagonal vertical scroll gets stolen — the single most
 * irritating way to get a swipe wrong, because it makes the calendar feel like
 * it's fighting you.
 */
export function shouldClaim(dx: number, dy: number, cfg: SwipeConfig = DEFAULT_SWIPE): boolean {
  return Math.abs(dx) > cfg.claimAfter && Math.abs(dx) > Math.abs(dy) * 1.5;
}

/**
 * Where the track should sit for a raw finger delta.
 *
 * `atStart`/`atEnd` aren't used to hard-stop — this calendar has no ends — but
 * the parameters exist so a bounded carousel can damp the rubber-band rather
 * than needing its own version of this maths.
 */
export function trackOffset(
  dx: number,
  width: number,
  opts: { atStart?: boolean; atEnd?: boolean } = {},
  cfg: SwipeConfig = DEFAULT_SWIPE,
): number {
  const blocked = (dx > 0 && opts.atStart) || (dx < 0 && opts.atEnd);
  const raw = blocked ? dx * cfg.overscrollDamping : dx;
  // Never let a single gesture travel more than one period; beyond that the
  // peek would run out of rendered content and show blank space.
  return Math.max(-width, Math.min(width, raw));
}

export type SwipeOutcome = -1 | 0 | 1;

/**
 * What a release means: -1 previous, +1 next, 0 snap back.
 *
 * A fast flick commits on velocity alone. Without that, a quick confident
 * gesture that happens not to travel far snaps back, which reads as the app
 * ignoring you.
 */
export function releaseOutcome(
  dx: number,
  width: number,
  elapsedMs: number,
  cfg: SwipeConfig = DEFAULT_SWIPE,
): SwipeOutcome {
  if (width <= 0) return 0;

  const velocity = elapsedMs > 0 ? Math.abs(dx) / elapsedMs : 0;
  const far = Math.abs(dx) > width * cfg.commitFraction;
  const flicked = velocity > cfg.flickVelocity && Math.abs(dx) > cfg.claimAfter;

  if (!far && !flicked) return 0;
  // Dragging content leftwards reveals what comes after it.
  return dx < 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Pinch-to-change-view
// ---------------------------------------------------------------------------

/**
 * Calendar views ordered from tightest to widest.
 *
 * Changing granularity by pinch is the established calendar idiom (spreading
 * your fingers zooms *in*, to fewer days), and it reads naturally as "show me
 * more / less time". A two-finger pan was the other candidate, but it collides
 * with the one-finger swipe far too easily to be worth the ambiguity.
 */
export const VIEW_SCALE = ["day", "3day", "week", "month"] as const;
export type ScaleView = (typeof VIEW_SCALE)[number];

/** How far the finger spread must change before it counts, as a ratio. */
export const PINCH_THRESHOLD = 0.25;

export function pinchDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The view a pinch lands on, or the current one when the gesture is too small
 * or already at an end of the scale.
 *
 * Spreading apart (ratio > 1) zooms in, towards fewer days.
 */
export function pinchView(current: ScaleView, startDist: number, nowDist: number): ScaleView {
  if (startDist <= 0 || nowDist <= 0) return current;

  const ratio = nowDist / startDist;
  if (Math.abs(ratio - 1) < PINCH_THRESHOLD) return current;

  const i = VIEW_SCALE.indexOf(current);
  if (i === -1) return current;

  const next = ratio > 1 ? i - 1 : i + 1;
  if (next < 0 || next >= VIEW_SCALE.length) return current;
  return VIEW_SCALE[next];
}
