"use client";

import { useRef, useState } from "react";
import { shouldClaim } from "./swipe";

/**
 * Swipe a list row sideways to trigger one of two shortcuts.
 *
 * The card owns *what* the swipe means (delete one way, plan the other); this
 * hook owns the gesture: claim it only once it's clearly horizontal so a
 * vertical scroll through the list isn't stolen, translate the row while the
 * finger's down, and fire the action on release past a commit distance.
 *
 * `didSwipe()` lets the row suppress the click that a touch sequence emits on
 * release, so a swipe never also opens the card it acted on. It stays true
 * until the next press, because the synthesized click can arrive a frame after
 * touchend and a timer race would sometimes clear it first.
 */

/** Sideways travel, in px, at which release commits the action. */
export const ROW_SWIPE_COMMIT_PX = 92;
/** Rubber-band ceiling so the row can't be dragged off into space. */
const ROW_SWIPE_MAX_PX = 116;

interface Opts {
  /** Swipe right (finger →) past the commit distance. Omit to disable that side. */
  onRight?: () => void;
  /** Swipe left (finger ←) past the commit distance. Omit to disable that side. */
  onLeft?: () => void;
  /** When false the row doesn't move — e.g. while in selection mode. */
  enabled?: boolean;
}

export function useRowSwipe({ onRight, onLeft, enabled = true }: Opts) {
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const start = useRef<{ x: number; y: number; claimed: boolean } | null>(null);
  const dxRef = useRef(0);
  const swiped = useRef(false);

  function set(v: number) {
    dxRef.current = v;
    setDx(v);
  }

  function snapBack() {
    setSettling(true);
    set(0);
  }

  const handlers = {
    onTouchStart: (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, claimed: false };
      swiped.current = false;
      setSettling(false);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const s = start.current;
      if (!s || e.touches.length !== 1) return;
      const t = e.touches[0];
      let ddx = t.clientX - s.x;
      const ddy = t.clientY - s.y;

      if (!s.claimed) {
        if (!shouldClaim(ddx, ddy)) return;
        s.claimed = true;
      }
      // Don't let the row travel toward an action that isn't wired up.
      if ((ddx > 0 && !onRight) || (ddx < 0 && !onLeft)) ddx = 0;
      swiped.current = true;
      set(Math.max(-ROW_SWIPE_MAX_PX, Math.min(ROW_SWIPE_MAX_PX, ddx)));
    },
    onTouchEnd: () => {
      const s = start.current;
      start.current = null;
      if (!s?.claimed) {
        snapBack();
        return;
      }
      const travelled = dxRef.current;
      // Always return the row to rest; the action (delete confirm, or navigating
      // to the plan) is what the user sees next, not a row stuck half-open.
      snapBack();
      if (travelled >= ROW_SWIPE_COMMIT_PX) onRight?.();
      else if (travelled <= -ROW_SWIPE_COMMIT_PX) onLeft?.();
    },
    onTouchCancel: () => {
      start.current = null;
      snapBack();
    },
  };

  return {
    dx,
    settling,
    /** True from the moment a swipe is claimed until the next press. */
    didSwipe: () => swiped.current,
    handlers,
  };
}
