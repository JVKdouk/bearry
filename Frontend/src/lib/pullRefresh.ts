/**
 * Pull-to-refresh arbitration, separated from the component so the decisions
 * are testable without a DOM.
 *
 * The hard part is the same as with the swipe: this gesture shares a surface
 * with ordinary scrolling. It must only engage when the user is already at the
 * top and pulling further down — otherwise scrolling back up through a long
 * list ends in an unwanted refresh, which is the failure that makes people stop
 * scrolling quickly.
 */

export interface PullConfig {
  /** Travel before anything is drawn, so a scroll overshoot shows nothing. */
  startAfter: number;
  /** Travel at which releasing triggers a refresh. */
  triggerAt: number;
  /** Furthest the indicator travels, however hard you pull. */
  maxPull: number;
  /** Resistance, so the pull feels like it's against something. */
  damping: number;
}

export const DEFAULT_PULL: PullConfig = {
  startAfter: 8,
  triggerAt: 64,
  maxPull: 96,
  damping: 0.5,
};

/**
 * Can a pull start here?
 *
 * Requires being at the very top AND moving downward AND more vertically than
 * horizontally — the last test keeps a diagonal swipe (which navigates the
 * calendar) from also arming a refresh.
 */
export function canPull(scrollTop: number, dy: number, dx: number): boolean {
  return scrollTop <= 0 && dy > 0 && Math.abs(dy) > Math.abs(dx);
}

/** How far the indicator has travelled for a raw finger delta. */
export function pullDistance(dy: number, cfg: PullConfig = DEFAULT_PULL): number {
  if (dy <= 0) return 0;
  return Math.min(cfg.maxPull, dy * cfg.damping);
}

/** Whether the indicator should be drawn at all yet. */
export function isPullVisible(distance: number, cfg: PullConfig = DEFAULT_PULL): boolean {
  return distance > cfg.startAfter;
}

/** Whether releasing at this distance should refresh. */
export function shouldRefresh(distance: number, cfg: PullConfig = DEFAULT_PULL): boolean {
  return distance >= cfg.triggerAt;
}

/**
 * How "armed" the gesture is, 0..1 — drives the spinner's rotation and opacity
 * so the control tells you whether letting go will do anything.
 */
export function pullProgress(distance: number, cfg: PullConfig = DEFAULT_PULL): number {
  if (cfg.triggerAt <= 0) return 0;
  return Math.max(0, Math.min(1, distance / cfg.triggerAt));
}
