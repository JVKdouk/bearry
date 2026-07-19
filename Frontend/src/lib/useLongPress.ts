"use client";

import { useRef, useCallback } from "react";
import { HOLD_MS, movedTooFar } from "./longPress";

/**
 * Fire a callback when an element is pressed and held still.
 *
 * Returns handlers to spread onto the target. Works for touch and mouse: a
 * timer starts on press, is cancelled if the pointer drifts past the tolerance
 * (a scroll, not a hold) or lifts early (a tap), and fires otherwise.
 *
 * The timing and tolerance live in longPress.ts so they can be tested; this
 * hook is only the plumbing that connects them to DOM events.
 */
export function useLongPress(onLongPress: () => void, ms: number = HOLD_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  const begin = useCallback(
    (x: number, y: number) => {
      cancel();
      fired.current = false;
      start.current = { x, y };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        onLongPress();
      }, ms);
    },
    [cancel, ms, onLongPress],
  );

  const move = useCallback(
    (x: number, y: number) => {
      if (start.current && movedTooFar(start.current, { x, y })) cancel();
    },
    [cancel],
  );

  return {
    /** True immediately after a long-press fired, so the same gesture's
     *  click/tap can be suppressed by the caller. Reset on the next press. */
    didFire: () => fired.current,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        begin(t.clientX, t.clientY);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0];
        move(t.clientX, t.clientY);
      },
      onTouchEnd: cancel,
      onTouchCancel: cancel,
      // Mouse support so long-press works with a trackpad too. Only the primary
      // button; a right-click has its own meaning.
      onMouseDown: (e: React.MouseEvent) => {
        if (e.button === 0) begin(e.clientX, e.clientY);
      },
      onMouseMove: (e: React.MouseEvent) => move(e.clientX, e.clientY),
      onMouseUp: cancel,
      onMouseLeave: cancel,
    },
  };
}
